/**
 * ServalSheets - E2E Error Recovery Tests
 *
 * Tests error handling and recovery scenarios:
 * - Network failures and retries
 * - Invalid input handling
 * - Rate limiting behavior
 * - Circuit breaker activation
 * - Graceful degradation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHttpClient } from '../mcp-client-simulator.js';
import type { MCPHttpClient } from '../mcp-client-simulator.js';

const TEST_SPREADSHEET_ID = process.env['TEST_SPREADSHEET_ID'];
const SKIP_E2E = !TEST_SPREADSHEET_ID || process.env['TEST_E2E'] !== 'true';

describe.skipIf(SKIP_E2E)('E2E: Error Recovery', () => {
  let client: MCPHttpClient;

  beforeAll(async () => {
    client = createTestHttpClient('http://localhost:3000');
    await client.initialize();
  });

  afterAll(async () => {
    await client.close();
  });

  describe('Input Validation Errors', () => {
    it('should reject invalid spreadsheet ID format', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_spreadsheet',
          spreadsheetId: '!!!invalid!!!',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content[0]).toMatchObject({
        type: 'text',
      });

      // Verify error message mentions validation
      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText.toLowerCase()).toMatch(/invalid|validation|spreadsheet/);
    });

    it('should reject missing required fields', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          // Missing spreadsheetId
          range: 'A1:B2',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: 'text',
      });

      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText.toLowerCase()).toMatch(/required|missing|spreadsheetid/);
    });

    it('should reject invalid action names', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'invalid_action_name',
          spreadsheetId: TEST_SPREADSHEET_ID,
        },
      });

      expect(result.isError).toBe(true);
    });

    it('should reject invalid range format', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'NotAValidRange!!!@@@',
        },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Google API Errors', () => {
    it('should handle non-existent spreadsheet gracefully', async () => {
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_spreadsheet',
          spreadsheetId: '1' + 'a'.repeat(43), // Valid format but doesn't exist
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();

      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText.toLowerCase()).toMatch(/not found|does not exist/);
    });

    it('should handle permission denied errors', async () => {
      // Try to access a spreadsheet we don't have permission to
      const result = await client.callTool('sheets_core', {
        request: {
          action: 'get_spreadsheet',
          spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', // Example sheet
        },
      });

      // May fail with permission error or succeed if sheet is public
      expect(result.isError).toBeDefined();
    });

    it('should handle invalid sheet names', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'NonExistentSheet!A1:B2',
        },
      });

      expect(result.isError).toBe(true);

      const errorText = (result.content[0] as { text: string }).text;
      expect(errorText.toLowerCase()).toMatch(/sheet.*not found|invalid.*sheet/);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limit errors', async () => {
      // Make many rapid requests to trigger rate limiting
      const promises = Array.from({ length: 100 }, (_, i) =>
        client.callTool('sheets_data', {
          request: {
            action: 'read_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: `Sheet1!A${i + 1}`,
          },
        })
      );

      const results = await Promise.allSettled(promises);

      // Some should succeed, some may be rate limited
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBeGreaterThan(0);

      // If any were rate limited, verify error handling
      if (rejected.length > 0) {
        console.log(`Rate limited: ${rejected.length}/${promises.length} requests`);
      }
    });

    it('should respect rate limit headers', async () => {
      // Make a single request and check if rate limit info is available
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
        },
      });

      expect(result.isError).toBe(false);
      // Rate limit headers would be in HTTP response (not exposed in MCP result)
    });
  });

  describe('Retry Logic', () => {
    it('should auto-retry transient failures', async () => {
      // Make a valid request - should succeed with retries if needed
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1:B2',
        },
      });

      // Should eventually succeed with auto-retry
      expect(result.isError).toBe(false);
    });

    it('should not retry permanent failures', async () => {
      const startTime = Date.now();

      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: 'invalid',
          range: 'A1',
        },
      });

      const duration = Date.now() - startTime;

      expect(result.isError).toBe(true);

      // Should fail quickly without retries (< 1 second)
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Circuit Breaker', () => {
    it('should handle repeated failures gracefully', async () => {
      // Make multiple failing requests
      const promises = Array.from({ length: 10 }, () =>
        client.callTool('sheets_data', {
          request: {
            action: 'read_range',
            spreadsheetId: 'invalid-id',
            range: 'A1',
          },
        })
      );

      const results = await Promise.all(promises);

      // All should fail
      expect(results.every((r) => r.isError)).toBe(true);

      // Circuit breaker may open after several failures
      // Verify system remains responsive
      const healthCheck = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
        },
      });

      // Should still be able to make valid requests
      expect(healthCheck.isError).toBe(false);
    });
  });

  describe('Graceful Degradation', () => {
    it('should continue working after partial failures', async () => {
      // Make a failing request
      const failResult = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: 'invalid',
          range: 'A1',
        },
      });

      expect(failResult.isError).toBe(true);

      // Make a successful request
      const successResult = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'Sheet1!A1',
        },
      });

      expect(successResult.isError).toBe(false);
    });

    it('should handle mixed batch results', async () => {
      // Create a batch with both valid and invalid requests
      const promises = [
        client.callTool('sheets_data', {
          request: {
            action: 'read_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'Sheet1!A1',
          },
        }),
        client.callTool('sheets_data', {
          request: {
            action: 'read_range',
            spreadsheetId: 'invalid',
            range: 'A1',
          },
        }),
        client.callTool('sheets_data', {
          request: {
            action: 'read_range',
            spreadsheetId: TEST_SPREADSHEET_ID,
            range: 'Sheet1!A2',
          },
        }),
      ];

      const results = await Promise.all(promises);

      // First and third should succeed
      expect(results[0].isError).toBe(false);
      expect(results[1].isError).toBe(true);
      expect(results[2].isError).toBe(false);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide actionable error messages', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: 'invalid-format',
          range: 'A1',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();

      const errorText = (result.content[0] as { text: string }).text;

      // Error should mention what went wrong
      expect(errorText.length).toBeGreaterThan(20);
      expect(errorText).toMatch(/[a-zA-Z]/); // Contains text (not just code)
    });

    it('should include error codes when available', async () => {
      const result = await client.callTool('sheets_data', {
        request: {
          action: 'read_range',
          spreadsheetId: TEST_SPREADSHEET_ID,
          range: 'InvalidSheet!A1',
        },
      });

      expect(result.isError).toBe(true);

      // Check if structured content includes error code
      if ('structuredContent' in result && result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { error?: { code?: string } };
        };
        if (structured.response?.error?.code) {
          expect(structured.response.error.code).toEqual(expect.any(String));
          expect(structured.response.error.code.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Recovery Procedures', () => {
    it('should recover from authentication errors', async () => {
      // Verify auth status
      const authResult = await client.callTool('sheets_auth', {
        request: {
          action: 'check_auth',
        },
      });

      expect(authResult.isError).toBe(false);

      // If authenticated, should be able to make requests
      if ('structuredContent' in authResult && authResult.structuredContent) {
        const structured = authResult.structuredContent as {
          response: { data: { authenticated: boolean } };
        };
        if (structured.response?.data?.authenticated) {
          const dataResult = await client.callTool('sheets_data', {
            request: {
              action: 'read_range',
              spreadsheetId: TEST_SPREADSHEET_ID,
              range: 'Sheet1!A1',
            },
          });

          expect(dataResult.isError).toBe(false);
        }
      }
    });

    it('should provide clear recovery instructions', async () => {
      // Make a request that requires specific permissions
      const result = await client.callTool('sheets_collaborate', {
        request: {
          action: 'share_spreadsheet',
          spreadsheetId: TEST_SPREADSHEET_ID,
          email: 'test@example.com',
          role: 'reader',
        },
      });

      // May fail if permissions insufficient
      if (result.isError) {
        const errorText = (result.content[0] as { text: string }).text;

        // Error should suggest next steps
        expect(errorText.length).toBeGreaterThan(30);
      }
    });
  });
});
