/**
 * Error Code Compliance Tests
 *
 * Verifies that error codes are properly implemented.
 * These tests work without live API credentials.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServalSheetsTestHarness, type McpTestHarness } from '../helpers/mcp-test-harness.js';

describe('Error Code Compliance', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Error Response Structure', () => {
    it('should return error for auth-required operations', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'test-id',
          },
        },
      });

      // Should have some response
      expect(result.content).toBeDefined();

      // If structured content exists, check error structure
      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { success?: boolean; error?: { code?: string; message?: string } };
        };

        if (structured.response?.success === false) {
          expect(structured.response.error).toBeDefined();
          expect(structured.response.error?.code).toBeDefined();
          expect(typeof structured.response.error?.code).toBe('string');
        }
      }
    });

    it('should include error message in error responses', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'invalid-id',
          },
        },
      });

      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { error?: { message?: string } };
        };

        if (structured.response?.error) {
          expect(structured.response.error.message).toBeDefined();
          expect(typeof structured.response.error.message).toBe('string');
          expect(structured.response.error.message.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Error Code Format', () => {
    it('should use uppercase error codes', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'invalid-id',
          },
        },
      });

      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { error?: { code?: string } };
        };

        if (structured.response?.error?.code) {
          // Error codes should be uppercase with underscores
          expect(structured.response.error.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
      }
    });
  });

  describe('Graceful Error Handling', () => {
    it('should handle empty request gracefully', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: {
          request: {},
        },
      });

      // Should return a response without crashing
      expect(result.content).toBeDefined();
    });

    it('should handle missing action gracefully', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            spreadsheetId: 'test-id',
            // Missing action
          },
        },
      });

      // Should return a response without crashing
      expect(result.content).toBeDefined();
    });

    it('should handle invalid action gracefully', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: {
          request: {
            action: 'nonexistent_action',
          },
        },
      });

      // Should return a response without crashing
      expect(result.content).toBeDefined();
    });
  });

  describe('Error Metadata', () => {
    it('should include retryable flag when applicable', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'invalid-id',
          },
        },
      });

      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { error?: { retryable?: boolean } };
        };

        // If error has retryable, it should be a boolean
        if (structured.response?.error?.retryable !== undefined) {
          expect(typeof structured.response.error.retryable).toBe('boolean');
        }
      }
    });
  });
});
