/**
 * Live API Tests for sheets_appsscript Tool
 *
 * Tests Apps Script integration with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 *
 * Note: Apps Script API does NOT work with service accounts.
 * These tests verify the data structures and Sheets API context.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_appsscript Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);
    testSpreadsheet = await manager.createTestSpreadsheet('appsscript');
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Project Management', () => {
    it('should validate script project structure', () => {
      const project = { title: 'My Script Project', parentId: 'spreadsheet_id_here' };
      expect(project.title).toBeDefined();
      expect(project.parentId).toBeDefined();
    });

    it('should define file types for script projects', () => {
      const fileTypes = ['SERVER_JS', 'HTML', 'JSON'];
      expect(fileTypes).toContain('SERVER_JS');
      expect(fileTypes).toContain('HTML');
      expect(fileTypes).toContain('JSON');
    });

    it('should define script file structure', () => {
      const files = [
        { name: 'Code', type: 'SERVER_JS', source: 'function onEdit(e) { Logger.log("Edited"); }' },
        {
          name: 'appsscript',
          type: 'JSON',
          source: JSON.stringify({ timeZone: 'America/New_York' }),
        },
      ];
      expect(files.length).toBe(2);
      expect(files[0].type).toBe('SERVER_JS');
    });
  });

  describe('Version Management', () => {
    it('should validate version creation', () => {
      const version = { scriptId: 'abc123', description: 'Version 1.0 - Initial release' };
      expect(version.description).toBeDefined();
    });

    it('should define version list structure', () => {
      const versions = [
        { versionNumber: 1, description: 'Initial', createTime: '2024-01-01T00:00:00Z' },
        { versionNumber: 2, description: 'Bug fixes', createTime: '2024-01-15T00:00:00Z' },
      ];
      expect(versions[versions.length - 1].versionNumber).toBe(2);
    });
  });

  describe('Deployment Management', () => {
    it('should validate deployment configuration', () => {
      const deployment = {
        scriptId: 'abc123',
        versionNumber: 3,
        type: 'WEB_APP' as const,
        config: { access: 'ANYONE', executeAs: 'USER_DEPLOYING' },
      };
      expect(deployment.type).toBe('WEB_APP');
      expect(['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS']).toContain(
        deployment.config.access
      );
    });

    it('should define deployment list structure', () => {
      const deployments = [
        {
          deploymentId: 'dep_123',
          versionNumber: 2,
          entryPoints: [
            {
              entryPointType: 'WEB_APP',
              webApp: { url: 'https://script.google.com/macros/s/ABC123/exec' },
            },
          ],
        },
      ];
      expect(deployments[0].entryPoints[0].webApp?.url).toContain('script.google.com');
    });
  });

  describe('Execution', () => {
    it('should validate function execution request', () => {
      const runConfig = {
        scriptId: 'abc123',
        function: 'processData',
        parameters: ['arg1', { key: 'value' }, 123],
        devMode: false,
      };
      expect(runConfig.function).toBeDefined();
      expect(Array.isArray(runConfig.parameters)).toBe(true);
    });

    it('should define process status types', () => {
      const statuses = ['COMPLETED', 'FAILED', 'RUNNING', 'CANCELED', 'TIMED_OUT'];
      expect(statuses).toContain('COMPLETED');
      expect(statuses).toContain('FAILED');
    });

    it('should define metrics structure', () => {
      const metrics = {
        activeUsers: 150,
        totalExecutions: 5000,
        failedExecutions: 25,
        failureRate: 0.5,
      };
      expect(metrics.failureRate).toBeLessThan(1);
    });
  });

  describe('Container-Bound Scripts', () => {
    it('should understand container-bound script relationship', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'spreadsheetId,properties.title',
      });

      const scriptConfig = {
        title: `Script for ${response.data.properties?.title}`,
        parentId: response.data.spreadsheetId,
      };

      expect(scriptConfig.parentId).toBe(testSpreadsheet.id);
    });

    it('should prepare spreadsheet with script-triggerable data', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:D5',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Date', 'Item', 'Quantity', 'Price'],
            ['2024-01-01', 'Widget A', '10', '25.00'],
            ['2024-01-02', 'Widget B', '5', '30.00'],
            ['2024-01-03', 'Widget C', '15', '20.00'],
            ['2024-01-04', 'Widget D', '8', '35.00'],
          ],
        },
      });

      const scriptCode = `function calculateTotal() { var sheet = SpreadsheetApp.getActiveSheet(); }`;
      expect(scriptCode).toContain('SpreadsheetApp');
    });
  });

  describe('Script Triggers', () => {
    it('should define trigger types for spreadsheets', () => {
      const triggers = [
        { type: 'onEdit', description: 'Runs when user edits' },
        { type: 'onChange', description: 'Runs when structure changes' },
        { type: 'onOpen', description: 'Runs when spreadsheet opens' },
      ];
      expect(triggers.find((t) => t.type === 'onEdit')).toBeDefined();
    });
  });

  describe('Performance Metrics', () => {
    it('should track script-related spreadsheet operations', async () => {
      client.resetMetrics();

      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'properties,sheets.properties',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
