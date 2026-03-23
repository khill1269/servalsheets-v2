/**
 * Live API Tests for sheets_collaborate Tool
 *
 * Tests sharing, comments, and collaboration operations against the real Google API.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

// Helper to add delay between tests to avoid quota limits
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runLiveTests)('sheets_collaborate Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;
  let sheetId: number;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);

    // Create ONE spreadsheet for all tests
    testSpreadsheet = await manager.createTestSpreadsheet('collaborate');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  // Add delay between tests to avoid quota limits
  afterEach(async () => {
    await delay(2000);
  });

  describe('Sharing Operations', () => {
    it('should list current permissions', async () => {
      const response = await client.drive.permissions.list({
        fileId: testSpreadsheet.id,
        fields: 'permissions(id,type,role,emailAddress)',
      });

      expect(response.status).toBe(200);
      expect(response.data.permissions).toBeDefined();
      expect(response.data.permissions!.length).toBeGreaterThanOrEqual(1);

      const ownerPermission = response.data.permissions!.find((p) => p.role === 'owner');
      expect(ownerPermission).toBeDefined();
    });

    it('should add reader permission', async () => {
      const response = await client.drive.permissions.create({
        fileId: testSpreadsheet.id,
        requestBody: { type: 'anyone', role: 'reader' },
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBeDefined();
      expect(response.data.role).toBe('reader');
    });

    it('should update and remove permission', async () => {
      const addResponse = await client.drive.permissions.create({
        fileId: testSpreadsheet.id,
        requestBody: { type: 'anyone', role: 'reader' },
      });

      const permissionId = addResponse.data.id!;

      // Update to commenter
      const updateResponse = await client.drive.permissions.update({
        fileId: testSpreadsheet.id,
        permissionId,
        requestBody: { role: 'commenter' },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.data.role).toBe('commenter');

      // Remove it
      const deleteResponse = await client.drive.permissions.delete({
        fileId: testSpreadsheet.id,
        permissionId,
      });

      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('Protected Range Operations', () => {
    it('should protect a range with warning only', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addProtectedRange: {
                protectedRange: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: 5,
                    startColumnIndex: 0,
                    endColumnIndex: 3,
                  },
                  description: 'Header rows - edit with caution',
                  warningOnly: true,
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      const protectedRangeId =
        response.data.replies![0].addProtectedRange?.protectedRange?.protectedRangeId;
      expect(protectedRangeId).toBeDefined();
    });

    it('should protect entire sheet except certain ranges', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addProtectedRange: {
                protectedRange: {
                  range: { sheetId },
                  description: 'Entire sheet protected',
                  warningOnly: false,
                  unprotectedRanges: [
                    {
                      sheetId,
                      startRowIndex: 5,
                      endRowIndex: 100,
                      startColumnIndex: 1,
                      endColumnIndex: 5,
                    },
                  ],
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should remove protection from a range', async () => {
      const addResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addProtectedRange: {
                protectedRange: {
                  range: {
                    sheetId,
                    startRowIndex: 10,
                    endRowIndex: 11,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                  warningOnly: true,
                },
              },
            },
          ],
        },
      });

      const protectedRangeId =
        addResponse.data.replies![0].addProtectedRange?.protectedRange?.protectedRangeId;

      const deleteResponse = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [{ deleteProtectedRange: { protectedRangeId } }],
        },
      });

      expect(deleteResponse.status).toBe(200);
    });
  });

  describe('Developer Metadata Operations', () => {
    it('should add developer metadata to spreadsheet', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              createDeveloperMetadata: {
                developerMetadata: {
                  metadataKey: `app_version_${Date.now()}`,
                  metadataValue: '1.0.0',
                  location: { spreadsheet: true },
                  visibility: 'DOCUMENT',
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      const metadataId =
        response.data.replies![0].createDeveloperMetadata?.developerMetadata?.metadataId;
      expect(metadataId).toBeDefined();
    });

    it('should add metadata to specific sheet', async () => {
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              createDeveloperMetadata: {
                developerMetadata: {
                  metadataKey: `sheet_type_${Date.now()}`,
                  metadataValue: 'data',
                  location: { sheetId },
                  visibility: 'DOCUMENT',
                },
              },
            },
          ],
        },
      });

      expect(response.status).toBe(200);
    });

    it('should find metadata by key', async () => {
      const testKey = `test_key_${Date.now()}`;

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              createDeveloperMetadata: {
                developerMetadata: {
                  metadataKey: testKey,
                  metadataValue: 'test_value',
                  location: { spreadsheet: true },
                  visibility: 'DOCUMENT',
                },
              },
            },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.developerMetadata.search({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          dataFilters: [{ developerMetadataLookup: { metadataKey: testKey } }],
        },
      });

      expect(response.status).toBe(200);
      expect(response.data.matchedDeveloperMetadata).toBeDefined();
      expect(response.data.matchedDeveloperMetadata!.length).toBeGreaterThan(0);
    });
  });

  describe('File Properties Operations', () => {
    it('should get file metadata', async () => {
      const response = await client.drive.files.get({
        fileId: testSpreadsheet.id,
        fields: 'id,name,mimeType,createdTime,modifiedTime,owners,capabilities',
      });

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(testSpreadsheet.id);
      expect(response.data.mimeType).toBe('application/vnd.google-apps.spreadsheet');
      expect(response.data.createdTime).toBeDefined();
      expect(response.data.modifiedTime).toBeDefined();
    });

    it('should rename spreadsheet', async () => {
      const newName = `SERVAL_TEST_renamed_${Date.now()}`;

      const response = await client.drive.files.update({
        fileId: testSpreadsheet.id,
        requestBody: { name: newName },
      });

      expect(response.status).toBe(200);
      expect(response.data.name).toBe(newName);
    });
  });

  describe('Revision History', () => {
    it('should list file revisions', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Change 1']] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A2',
        valueInputOption: 'RAW',
        requestBody: { values: [['Change 2']] },
      });

      const response = await client.drive.revisions.list({
        fileId: testSpreadsheet.id,
        fields: 'revisions(id,modifiedTime,lastModifyingUser)',
      });

      expect(response.status).toBe(200);
      expect(response.data.revisions).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle permission denied gracefully', async () => {
      await expect(
        client.drive.permissions.create({
          fileId: testSpreadsheet.id,
          requestBody: { type: 'user', role: 'reader', emailAddress: 'not-a-valid-email' },
        })
      ).rejects.toThrow();
    });

    it('should handle non-existent file', async () => {
      await expect(
        client.drive.permissions.list({ fileId: 'non-existent-file-id-12345' })
      ).rejects.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should track collaboration API latency', async () => {
      client.resetMetrics();

      await client.trackOperation('permissionsList', 'GET', () =>
        client.drive.permissions.list({
          fileId: testSpreadsheet.id,
          fields: 'permissions(id,type,role)',
        })
      );

      await client.trackOperation('filesGet', 'GET', () =>
        client.drive.files.get({
          fileId: testSpreadsheet.id,
          fields: 'id,name',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });
});
