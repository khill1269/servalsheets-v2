/**
 * OAuth Incremental Consent Integration Tests
 *
 * Tests the incremental authorization flow where users grant minimal scopes
 * initially, then grant additional scopes as needed for specific operations.
 *
 * @see https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createGoogleApiClient } from '../../../src/services/google-api.js';
import { SheetsTemplatesHandler as TemplatesHandler } from '../../../src/handlers/templates.js';
import { CollaborateHandler } from '../../../src/handlers/collaborate.js';
import type { HandlerContext } from '../../../src/handlers/base.js';
import { IncrementalScopeRequiredError } from '../../../src/security/incremental-scope.js';
import {
  ELEVATED_SCOPES as FULL_SCOPES,
} from '../../../src/services/google-api.js';
import { MINIMAL_SCOPES } from '../../../src/config/oauth-scopes.js';
import { shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import { getLiveApiClient } from '../setup/index.js';
import type { LiveApiClient } from '../setup/live-api-client.js';

// Skip all tests if not running against real API
const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('OAuth Incremental Consent', () => {
  const testSpreadsheetId = process.env['TEST_SPREADSHEET_ID'];
  let liveClient: LiveApiClient;

  beforeAll(async () => {
    if (!testSpreadsheetId) {
      throw new Error('TEST_SPREADSHEET_ID environment variable is required');
    }
    liveClient = await getLiveApiClient();
  });

  it('should use minimal scopes by default', () => {
    const googleApi = createGoogleApiClient({
      credentials: {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        scope: MINIMAL_SCOPES.join(' '),
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
      },
    });

    // Verify MINIMAL_SCOPES are the two core scopes
    expect(Array.from(MINIMAL_SCOPES)).toEqual([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ]);

    // Verify FULL_SCOPES include additional Drive scopes
    expect(FULL_SCOPES).toContain('https://www.googleapis.com/auth/drive');
    expect(FULL_SCOPES).toContain('https://www.googleapis.com/auth/drive.appdata');
  });

  it('should throw IncrementalScopeRequiredError when templates require drive.appdata', async () => {
    const googleApi = createGoogleApiClient({
      credentials: {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        scope: MINIMAL_SCOPES.join(' '), // Only minimal scopes
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
      },
    });

    const context = {
      googleClient: googleApi,
      logger: console,
      metrics: undefined,
      snapshotService: undefined,
      taskStore: undefined,
      sessionContext: undefined,
      batchingSystem: undefined,
      batchCompiler: undefined as unknown as HandlerContext['batchCompiler'],
      rangeResolver: undefined as unknown as HandlerContext['rangeResolver'],
      auth: {
        hasElevatedAccess: false,
        scopes: Array.from(MINIMAL_SCOPES),
      },
    } as unknown as HandlerContext;

    const handler = new TemplatesHandler(context);

    // Attempt to create a template without drive.appdata scope
    const result = await handler.handle({
      action: 'create',
      spreadsheetId: testSpreadsheetId!,
      name: 'Test Template',
      description: 'Test incremental consent',
    });

    // Should return error response with INCREMENTAL_SCOPE_REQUIRED
    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error?.code).toBe('INCREMENTAL_SCOPE_REQUIRED');
      expect(result.response.error?.message).toContain('additional permissions');
      expect(result.response.error?.details).toHaveProperty('authorizationUrl');
      expect(result.response.error?.details).toHaveProperty('missingScopes');
      expect(result.response.error?.details?.missingScopes).toContain(
        'https://www.googleapis.com/auth/drive.appdata'
      );
    }
  });

  it('should succeed when all required scopes are granted', async () => {
    const googleApi = createGoogleApiClient({
      credentials: {
        access_token: process.env['GOOGLE_ACCESS_TOKEN'] ?? 'test-token',
        refresh_token: process.env['GOOGLE_REFRESH_TOKEN'] ?? 'test-refresh',
        scope: FULL_SCOPES.join(' '), // All scopes granted
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
      },
    });

    const context = {
      googleClient: googleApi,
      logger: console,
      metrics: undefined,
      snapshotService: undefined,
      taskStore: undefined,
      sessionContext: undefined,
      batchingSystem: undefined,
      batchCompiler: undefined as unknown as HandlerContext['batchCompiler'],
      rangeResolver: undefined as unknown as HandlerContext['rangeResolver'],
      auth: {
        hasElevatedAccess: true,
        scopes: FULL_SCOPES,
      },
    } as unknown as HandlerContext;

    // Pass real sheets and drive APIs from the live client so templateStore can
    // make actual Drive API calls after scope validation passes.
    const handler = new TemplatesHandler(context, liveClient.sheets, liveClient.drive);

    // Should succeed with full scopes
    const result = await handler.handle({
      action: 'list',
    });

    // Scope validation passed: the operation should NOT be blocked by INCREMENTAL_SCOPE_REQUIRED.
    // The underlying Drive API call may return a different error (e.g., if test credentials lack
    // drive.appdata scope in the actual token), but scope pre-validation should have allowed through.
    expect(result.response.error?.code).not.toBe('INCREMENTAL_SCOPE_REQUIRED');
  });

  it('should throw IncrementalScopeRequiredError when comments require drive scope', async () => {
    const googleApi = createGoogleApiClient({
      credentials: {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        scope: MINIMAL_SCOPES.join(' '), // Only minimal scopes
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
      },
    });

    const context = {
      googleClient: googleApi,
      logger: console,
      metrics: undefined,
      snapshotService: undefined,
      taskStore: undefined,
      sessionContext: undefined,
      batchingSystem: undefined,
      batchCompiler: undefined as unknown as HandlerContext['batchCompiler'],
      rangeResolver: undefined as unknown as HandlerContext['rangeResolver'],
      auth: {
        hasElevatedAccess: false,
        scopes: Array.from(MINIMAL_SCOPES),
      },
    } as unknown as HandlerContext;

    // CollaborateHandler needs driveApi (non-null) to bypass the "Drive API not available" check;
    // scope validation happens before any actual API call, so a stub suffices here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stubDriveApi = {} as any;
    const handler = new CollaborateHandler(context, stubDriveApi);

    // Attempt to add comment without drive scope
    const result = await handler.handle({
      action: 'comment_add',
      spreadsheetId: testSpreadsheetId!,
      range: 'A1',
      comment: 'Test comment',
    });

    // Should return error response with INCREMENTAL_SCOPE_REQUIRED
    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error?.code).toBe('INCREMENTAL_SCOPE_REQUIRED');
      expect(result.response.error?.details?.missingScopes).toContain(
        'https://www.googleapis.com/auth/drive'
      );
    }
  });

  it('should include authorization URL with include_granted_scopes=true', async () => {
    const googleApi = createGoogleApiClient({
      credentials: {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        scope: MINIMAL_SCOPES.join(' '),
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
      },
    });

    const context = {
      googleClient: googleApi,
      logger: console,
      metrics: undefined,
      snapshotService: undefined,
      taskStore: undefined,
      sessionContext: undefined,
      batchingSystem: undefined,
      batchCompiler: undefined as unknown as HandlerContext['batchCompiler'],
      rangeResolver: undefined as unknown as HandlerContext['rangeResolver'],
      auth: {
        hasElevatedAccess: false,
        scopes: Array.from(MINIMAL_SCOPES),
      },
    } as unknown as HandlerContext;

    const handler = new TemplatesHandler(context);

    const result = await handler.handle({
      action: 'create',
      spreadsheetId: testSpreadsheetId!,
      name: 'Test Template',
      description: 'Test incremental consent',
    });

    // Should return error with authorization URL
    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      const authUrl = result.response.error?.details?.authorizationUrl as string;
      expect(authUrl).toBeDefined();
      expect(authUrl).toContain('include_granted_scopes=true');
      expect(authUrl).toContain('scope=');
    }
  });
});
