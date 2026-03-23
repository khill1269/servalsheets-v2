/**
 * Tests for MCP Server Card (SEP-1649)
 */

import { describe, it, expect } from 'vitest';
import { getMcpServerCard, getMcpServerCardWithRuntimeConfig } from '../src/server/well-known.js';
import { validateEnv } from '../src/config/env.js';
import { getPromptsCatalogCount } from '../src/resources/prompts-catalog.js';

describe('MCP Server Card (SEP-1649)', () => {
  const originalCorsOrigins = process.env['CORS_ORIGINS'];
  const originalRateLimitMax = process.env['RATE_LIMIT_MAX'];
  const originalLegacySse = process.env['ENABLE_LEGACY_SSE'];

  describe('getMcpServerCard', () => {
    it('should return valid server card structure', () => {
      const card = getMcpServerCard();

      // Required fields per SEP-1649
      expect(card.mcp_version).toBe('2025-11-25');
      expect(card.server_name).toBe('servalsheets');
      expect(card.server_version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(card.description).toEqual(expect.any(String));
      expect(card.description.length).toBeGreaterThan(0);
    });

    it('should include endpoints configuration', () => {
      const card = getMcpServerCard('https://api.example.com');

      expect(card.endpoints).toBeDefined();
      expect(card.endpoints.streamable_http).toBe('https://api.example.com/mcp');
      expect(card.endpoints.sse).toBeUndefined();
      expect(card.endpoints.stdio).toBe(true);
    });

    it('should include legacy SSE endpoint when ENABLE_LEGACY_SSE=true', () => {
      process.env['ENABLE_LEGACY_SSE'] = 'true';
      validateEnv();

      const card = getMcpServerCard('https://api.example.com');
      expect(card.endpoints.sse).toBe('https://api.example.com/sse');

      if (originalLegacySse === undefined) {
        delete process.env['ENABLE_LEGACY_SSE'];
      } else {
        process.env['ENABLE_LEGACY_SSE'] = originalLegacySse;
      }
      validateEnv();
    });

    it('should include capabilities summary', () => {
      const card = getMcpServerCard();

      expect(card.capabilities).toBeDefined();
      expect(card.capabilities.tools).toEqual({
        count: expect.any(Number),
        actions: expect.any(Number),
      });
      expect(card.capabilities.resources).toEqual({
        templates: true,
        subscriptions: true,
      });
      expect(card.capabilities.prompts).toEqual({
        count: getPromptsCatalogCount(),
      });
      expect(card.capabilities.tasks).toBe(true);
      expect(card.capabilities.elicitation).toEqual({
        form: true,
        url: true,
      });
    });

    it('should advertise OAuth metadata without requiring auth by default', () => {
      const card = getMcpServerCard();

      expect(card.authentication).toBeDefined();
      expect(card.authentication?.required).toBe(false);
      expect(card.authentication?.methods).toContain('oauth2');
      expect(card.authentication?.oauth2).toBeDefined();
      expect(card.authentication?.oauth2?.pkce_required).toBe(true);
      expect(card.authentication?.oauth2?.authorization_endpoint).toContain('google.com');
    });

    it('should mark authentication as required when runtime config enables OAuth', () => {
      const card = getMcpServerCardWithRuntimeConfig(
        {
          corsOrigins: ['https://claude.ai'],
          rateLimitMax: 120,
          legacySseEnabled: false,
          authenticationRequired: true,
        },
        'https://api.example.com'
      );

      expect(card.authentication?.required).toBe(true);
    });

    it('should include security configuration', () => {
      const card = getMcpServerCard();

      expect(card.security).toBeDefined();
      expect(card.security?.tls_required).toBe(true);
      expect(card.security?.min_tls_version).toBe('1.2');
    });

    it('should derive cors origins and rate limits from runtime configuration', () => {
      process.env['CORS_ORIGINS'] = 'https://alpha.example, https://beta.example';
      process.env['RATE_LIMIT_MAX'] = '240';

      try {
        validateEnv();
        const card = getMcpServerCard();

        expect(card.security?.cors_origins).toEqual([
          'https://alpha.example',
          'https://beta.example',
        ]);
        expect(card.rate_limits?.requests_per_minute).toBe(240);
      } finally {
        if (originalCorsOrigins === undefined) {
          delete process.env['CORS_ORIGINS'];
        } else {
          process.env['CORS_ORIGINS'] = originalCorsOrigins;
        }

        if (originalRateLimitMax === undefined) {
          delete process.env['RATE_LIMIT_MAX'];
        } else {
          process.env['RATE_LIMIT_MAX'] = originalRateLimitMax;
        }
        validateEnv();
      }
    });

    it('should include discovery metadata', () => {
      const card = getMcpServerCard();

      expect(card.links).toBeDefined();
      expect(card.links?.repository).toContain('github.com');
      expect(card.keywords).toBeInstanceOf(Array);
      expect(card.keywords).toContain('google-sheets');
      expect(card.license).toBe('MIT');
    });

    it('should include publisher information', () => {
      const card = getMcpServerCard();

      expect(card.publisher).toBeDefined();
      expect(card.publisher?.name).toEqual(expect.any(String));
      expect((card.publisher?.name ?? '').length).toBeGreaterThan(0);
    });

    it('should use relative paths without serverUrl', () => {
      const card = getMcpServerCard();

      expect(card.endpoints.streamable_http).toBe('/mcp');
      expect(card.endpoints.sse).toBeUndefined();
    });

    it('should include schema reference', () => {
      const card = getMcpServerCard();

      expect(card.$schema).toBe('https://modelcontextprotocol.io/schemas/mcp-server-card.json');
    });
  });
});
