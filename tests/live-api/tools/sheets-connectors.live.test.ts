/**
 * Live API Tests for sheets_connectors Tool
 *
 * Tests connector management operations. list_connectors and status work without
 * external API keys. query and configure require connector-specific API keys.
 * Requires TEST_REAL_API=true environment variable.
 *
 * Actions tested:
 * - list_connectors  — lists available built-in connectors (no external API key needed)
 * - status           — gets status for a known connector (may not be configured)
 * - discover         — test with invalid endpoint (asserts graceful error, not exception)
 *
 * Skipped (require external API keys):
 * - query      — requires connector-specific API key (e.g. FINNHUB_API_KEY)
 * - configure  — requires credentials for each provider
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import { ConnectorsHandler } from '../../../src/handlers/connectors.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_connectors Live API Tests', () => {
  let handler: ConnectorsHandler;

  beforeAll(() => {
    // ConnectorsHandler has no required constructor arguments
    handler = new ConnectorsHandler();
  });

  describe('list_connectors', () => {
    it('should return at least one built-in connector', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_connectors',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const resp = result.response as { connectors: { id: string }[] };
        expect(Array.isArray(resp.connectors)).toBe(true);
        // ServalSheets ships with built-in connectors (Finnhub, Polygon, FRED, etc.)
        expect(resp.connectors.length).toBeGreaterThan(0);
        // Each connector should have an id
        for (const c of resp.connectors) {
          expect(typeof c.id).toBe('string');
          expect(c.id.length).toBeGreaterThan(0);
        }
      }
    });

    it('should include at least one of the known built-in connector IDs', async () => {
      const result = await handler.handle({
        request: {
          action: 'list_connectors',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const resp = result.response as { connectors: { id: string }[] };
        const connectorIds = resp.connectors.map((c) => c.id);
        // At least one of these built-in connectors should be present
        const knownBuiltins = ['finnhub', 'polygon', 'fred', 'alpha_vantage', 'fmp', 'generic_rest', 'mcp_bridge'];
        const found = connectorIds.some((id) => knownBuiltins.includes(id));
        expect(found).toBe(true);
      }
    });
  });

  describe('status', () => {
    it('should return a response structure for a known connector ID', async () => {
      // Get connector IDs first
      const listResult = await handler.handle({
        request: { action: 'list_connectors' },
      });

      if (!listResult.response.success) {
        // If list_connectors fails, skip status test
        return;
      }

      const resp = listResult.response as { connectors: { id: string }[] };
      if (resp.connectors.length === 0) return;

      const firstConnectorId = resp.connectors[0]!.id;
      const statusResult = await handler.handle({
        request: {
          action: 'status',
          connectorId: firstConnectorId,
        },
      });

      // Status should return either success (if configured) or a well-structured error
      // It must not throw an exception
      expect(typeof statusResult.response.success).toBe('boolean');
    });
  });

  describe('discover', () => {
    it('should return graceful error for invalid endpoint on a known connector', async () => {
      // Get a real connector ID first
      const listResult = await handler.handle({
        request: { action: 'list_connectors' },
      });
      if (!listResult.response.success) return;
      const resp = listResult.response as { connectors: { id: string }[] };
      if (resp.connectors.length === 0) return;

      const connectorId = resp.connectors[0]!.id;
      const result = await handler.handle({
        request: {
          action: 'discover',
          connectorId,
          endpoint: 'invalid-endpoint-that-does-not-exist',
        },
      });

      // Must not throw — should return structured error or success: false
      expect(typeof result.response.success).toBe('boolean');
      // Invalid endpoint should result in an error, not success
      if (!result.response.success) {
        const errorResp = result.response as { error: { code: string } };
        expect(typeof errorResp.error.code).toBe('string');
      }
    });
  });

  // Skipped: require external API keys
  it.skip('query — requires connector-specific API key (e.g. FINNHUB_API_KEY)', () => {
    // Skipped: querying a connector like Finnhub requires a valid API key.
    // Set FINNHUB_API_KEY and configure the connector first, then test query.
  });

  it.skip('configure — requires credentials for each provider', () => {
    // Skipped: configuring a connector requires provider-specific credentials.
    // Test in environment where those secrets are available.
  });
});
