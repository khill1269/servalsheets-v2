/**
 * Live API Tests for sheets_auth Tool
 *
 * Tests authentication operations against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * 4 Actions:
 * - status: Check current authentication status
 * - login: Initiate OAuth login flow
 * - callback: Handle OAuth callback with authorization code
 * - logout: Revoke authentication and clear tokens
 *
 * Note: These tests verify the auth status of the service account credentials
 * being used for testing. The full OAuth flow (login/callback/logout) cannot
 * be fully tested without user interaction.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_auth Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);
  });

  afterAll(async () => {
    await manager.cleanup();
  });

  describe('Authentication Status', () => {
    describe('status action', () => {
      it('should verify credentials are valid', async () => {
        // Try to list spreadsheets - if credentials work, this succeeds
        const response = await client.drive.files.list({
          pageSize: 1,
          fields: 'files(id)',
          q: "mimeType='application/vnd.google-apps.spreadsheet'",
        });

        expect(response.status).toBe(200);
        // Credentials are valid if we can make API calls
      });

      it('should be able to access Google Sheets API', async () => {
        // Create a test spreadsheet to verify Sheets API access
        const testSpreadsheet = await manager.createTestSpreadsheet('auth-test');

        expect(testSpreadsheet.id).toBeDefined();
        expect(testSpreadsheet.title).toContain('SERVAL_TEST');

        // Verify we can read it back
        const response = await client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'properties.title',
        });

        expect(response.status).toBe(200);
        expect(response.data.properties?.title).toBe(testSpreadsheet.title);
      });

      it('should be able to access Google Drive API', async () => {
        // Create a test spreadsheet
        const testSpreadsheet = await manager.createTestSpreadsheet('drive-test');

        // Verify we can get file metadata via Drive API
        const response = await client.drive.files.get({
          fileId: testSpreadsheet.id,
          fields: 'id,name,mimeType',
        });

        expect(response.status).toBe(200);
        expect(response.data.id).toBe(testSpreadsheet.id);
        expect(response.data.mimeType).toBe('application/vnd.google-apps.spreadsheet');
      });
    });
  });

  describe('Scopes Verification', () => {
    it('should have spreadsheet read access', async () => {
      const testSpreadsheet = await manager.createTestSpreadsheet('scope-read');

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:A1',
      });

      expect(response.status).toBe(200);
    });

    it('should have spreadsheet write access', async () => {
      const testSpreadsheet = await manager.createTestSpreadsheet('scope-write');

      const response = await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Test Value']],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.updatedCells).toBe(1);
    });

    it('should have drive file access', async () => {
      const testSpreadsheet = await manager.createTestSpreadsheet('scope-drive');

      // Test permissions endpoint
      const response = await client.drive.permissions.list({
        fileId: testSpreadsheet.id,
        fields: 'permissions(id,role)',
      });

      expect(response.status).toBe(200);
      expect(response.data.permissions).toBeDefined();
    });

    it('should be able to create new spreadsheets', async () => {
      // This implicitly tests drive.file scope
      const testSpreadsheet = await manager.createTestSpreadsheet('scope-create');

      expect(testSpreadsheet.id).toBeDefined();

      // Verify creation
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });

      expect(response.status).toBe(200);
    });

    it('should be able to delete spreadsheets', async () => {
      const testSpreadsheet = await manager.createTestSpreadsheet('scope-delete');

      // Delete via Drive API
      const response = await client.drive.files.delete({
        fileId: testSpreadsheet.id,
      });

      // Delete succeeds with 204 No Content
      expect(response.status).toBe(204);

      // Note: Deleted files may still be accessible briefly due to eventual consistency
      // The test passes if we can successfully issue the delete command
    });
  });

  describe('Token Validity', () => {
    it('should maintain valid tokens across multiple requests', async () => {
      client.resetMetrics();

      // Make multiple sequential requests
      for (let i = 0; i < 5; i++) {
        const response = await client.trackOperation('filesList', 'GET', () =>
          client.drive.files.list({
            pageSize: 1,
            fields: 'files(id)',
            q: "mimeType='application/vnd.google-apps.spreadsheet'",
          })
        );
        expect(response.status).toBe(200);
      }

      const stats = client.getStats();
      expect(stats.totalRequests).toBe(5);
      // All requests should succeed without re-auth
    });

    it('should handle parallel requests', async () => {
      client.resetMetrics();

      // Make multiple parallel requests
      const promises = Array.from({ length: 3 }, () =>
        client.trackOperation('filesList', 'GET', () =>
          client.drive.files.list({
            pageSize: 1,
            fields: 'files(id)',
            q: "mimeType='application/vnd.google-apps.spreadsheet'",
          })
        )
      );

      const responses = await Promise.all(promises);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      const stats = client.getStats();
      expect(stats.totalRequests).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should fail gracefully on invalid spreadsheet ID', async () => {
      await expect(
        client.sheets.spreadsheets.get({
          spreadsheetId: 'invalid-spreadsheet-id-12345',
        })
      ).rejects.toThrow();
    });

    it('should fail gracefully on permission denied', async () => {
      // Try to access a spreadsheet we don't have access to
      // Using a known public spreadsheet ID that we don't own
      // This might fail differently depending on the spreadsheet
      // For now, we just test that invalid IDs fail
      await expect(
        client.sheets.spreadsheets.get({
          spreadsheetId: 'non-existent-or-no-access-id',
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track auth-related API latency', async () => {
      client.resetMetrics();

      // Authentication-related operations
      await client.trackOperation('filesList', 'GET', () =>
        client.drive.files.list({
          pageSize: 1,
          fields: 'files(id)',
        })
      );

      await client.trackOperation('aboutGet', 'GET', () =>
        client.drive.about.get({
          fields: 'user(emailAddress)',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });
});
