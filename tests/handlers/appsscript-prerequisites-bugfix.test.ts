/**
 * AppsScript Handler - API Prerequisites Bug Fix Tests (Phase 0.9)
 *
 * Tests for bug: AppsScript API calls fail with "Request contains an invalid argument"
 * Evidence from test log: list_processes: "invalid argument", get: "invalid argument"
 *
 * Root causes:
 * 1. Apps Script API not enabled in GCP project (returns 403)
 * 2. Missing OAuth scopes (script.projects, script.processes) (returns 403)
 * 3. Using service account instead of OAuth (Apps Script requires user auth)
 * 4. Generic error messages don't explain prerequisites
 *
 * Fix: Enhanced error handling with prerequisite checks and helpful guidance
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsAppsScriptHandler } from '../../src/handlers/appsscript.js';
import type { HandlerContext } from '../../src/handlers/base.js';

describe('SheetsAppsScriptHandler - API Prerequisites (BUG FIX 0.9)', () => {
  let handler: SheetsAppsScriptHandler;
  let mockContext: HandlerContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockGoogleClient: any;

  beforeEach(() => {
    // Create mock Google client with OAuth credentials
    mockGoogleClient = {
      oauth2: {
        credentials: {
          access_token: 'test-token',
        },
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/script.projects',
        'https://www.googleapis.com/auth/script.processes',
      ],
    };

    // Create mock context
    mockContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock client type
      googleClient: mockGoogleClient as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      sheetsApi: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock auth type
      authClient: { credentials: { access_token: 'test-token' } } as any,
      authService: {
        isAuthenticated: vi.fn().mockReturnValue(true),
        getClient: vi.fn().mockResolvedValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock service type
      } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({
          a1Notation: 'Sheet1!A1:A5',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: '',
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock resolver type
      } as any,
    };

    handler = new SheetsAppsScriptHandler(mockContext);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('API not enabled error handling (BUG FIX 0.9)', () => {
    it('should provide helpful error when Apps Script API returns 403 forbidden', async () => {
      // Mock fetch to return 403 (API not enabled)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Google Apps Script API has not been used in project',
              status: 'PERMISSION_DENIED',
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_processes',
        },
      });

      // Should return error with helpful guidance
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('Apps Script API');

      // BUG FIX: Should mention how to enable API
      const errorText =
        (result.response.error?.message || '') +
        (result.response.error?.resolution || '') +
        (result.response.error?.details?.resolution || '');
      expect(errorText.toLowerCase().includes('enable')).toBe(true);
    });

    it('should provide helpful error for missing OAuth scopes', async () => {
      // Mock fetch to return 403 (insufficient scopes)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Insufficient Permission',
              status: 'PERMISSION_DENIED',
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'test-script-id',
        },
      });

      // Should return error
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();

      // BUG FIX: Should mention required scopes
      const errorText =
        (result.response.error?.message || '') +
        (result.response.error?.resolution || '') +
        (result.response.error?.details?.resolution || '');
      expect(errorText.includes('script.projects') || errorText.includes('OAuth scopes')).toBe(
        true
      );
    });

    it('should provide helpful error for invalid argument (400)', async () => {
      // Mock fetch to return 400 (invalid argument)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Request contains an invalid argument',
              status: 'INVALID_ARGUMENT',
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'invalid-id',
        },
      });

      // Should return error
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });

    it('should provide helpful error for 404 not found', async () => {
      // Mock fetch to return 404 (script not found)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            error: {
              code: 404,
              message: 'Requested entity was not found',
              status: 'NOT_FOUND',
            },
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          scriptId: 'nonexistent-script',
        },
      });

      // Should return NOT_FOUND error
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('authentication requirement', () => {
    it('should require authentication', async () => {
      // Create new context without googleClient
      const noAuthContext = {
        ...mockContext,
        googleClient: null,
      };

      // Create new handler with no-auth context
      const noAuthHandler = new SheetsAppsScriptHandler(noAuthContext);

      await expect(
        noAuthHandler.handle({
          request: {
            action: 'list_processes',
          },
        })
      ).rejects.toMatchObject({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      });
    });

    it('should require OAuth access token', async () => {
      // Remove access token
      mockGoogleClient.oauth2.credentials.access_token = null;

      const result = await handler.handle({
        request: {
          action: 'list_processes',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('AUTH_ERROR');
    });
  });

  describe('successful API calls', () => {
    it('should handle successful list_processes', async () => {
      // Mock successful API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            processes: [
              {
                processId: 'process-1',
                functionName: 'myFunction',
                processType: 'EDITOR',
                processStatus: 'COMPLETED',
                startTime: '2024-01-01T00:00:00Z',
              },
            ],
          })
        ),
      });

      const result = await handler.handle({
        request: {
          action: 'list_processes',
        },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.processes).toBeDefined();
    });
  });

  describe('regression tests', () => {
    it('should handle unknown action gracefully', async () => {
      const result = await handler.handle({
        request: {
          // @ts-expect-error - Testing invalid action
          action: 'invalid_action',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });
});
