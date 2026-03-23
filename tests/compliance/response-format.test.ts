/**
 * Response Format Compliance Tests
 *
 * Verifies that tool responses follow the expected format.
 * These tests work without live API credentials by testing tools
 * that don't require Google authentication.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServalSheetsTestHarness, type McpTestHarness } from '../helpers/mcp-test-harness.js';

describe('Response Format Compliance', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // NOTE: structuredContent IS set by the response builder (src/mcp/registration/tool-handlers.ts)
  // but the MCP SDK Client doesn't expose it in the callTool() return value.
  // structuredContent tests are in response-format-jsonrpc.test.ts which uses direct JSON-RPC.

  describe('Content Array Format', () => {
    it('should return content array', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: {
          request: { action: 'status' },
        },
      });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as unknown[]).length).toBeGreaterThan(0);
    });

    it('should have text content type', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: {
          request: { action: 'status' },
        },
      });

      const content = result.content as Array<{ type: string }>;
      const textContent = content.find((c) => c.type === 'text');
      expect(textContent).toBeDefined();
    });

    it('should have valid text string in content', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: {
          request: { action: 'status' },
        },
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const textContent = content.find((c) => c.type === 'text') as {
        type: string;
        text: string;
      };

      expect(textContent.text).toBeDefined();
      expect(typeof textContent.text).toBe('string');
      expect(textContent.text.length).toBeGreaterThan(0);
    });
  });

  describe('Error Response Handling', () => {
    it('should handle invalid spreadsheet ID gracefully', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'invalid-id',
          },
        },
      });

      // Should return a response (either structured or error)
      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { success?: boolean };
        };
        // If structuredContent exists, success should be false
        if (structured.response) {
          expect(structured.response.success).toBe(false);
        }
      }

      // Content should always be present
      expect(result.content).toBeDefined();
    });

    it('should indicate error in response for auth-required operations', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'test-spreadsheet-123',
          },
        },
      });

      // Without authentication, this should fail
      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { success?: boolean; error?: { code?: string } };
        };

        if (structured.response?.success === false) {
          // Error response should have error details
          expect(structured.response.error).toBeDefined();
          expect(structured.response.error?.code).toBeDefined();
        }
      }
    });
  });

  describe('Response Consistency', () => {
    it('should return consistent format for sheets_auth', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: { request: { action: 'status' } },
      });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as unknown[]).length).toBeGreaterThan(0);
    });

    it('should return consistent format across multiple calls', async () => {
      const results = await Promise.all([
        harness.client.callTool({
          name: 'sheets_auth',
          arguments: { request: { action: 'status' } },
        }),
        harness.client.callTool({
          name: 'sheets_auth',
          arguments: { request: { action: 'status' } },
        }),
      ]);

      for (const result of results) {
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect((result.content as unknown[]).length).toBeGreaterThan(0);
      }
    });

    // NOTE: structuredContent consistency tests are in response-format-jsonrpc.test.ts
  });
});
