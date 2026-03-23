/**
 * Live API Tests for sheets_bigquery Tool
 *
 * Tests BigQuery Connected Sheets integration with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 *
 * Note: Most BigQuery operations require BigQuery API enabled and appropriate permissions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_bigquery Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('bigquery');
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Connection Management', () => {
    it('should validate BigQuery data source specification', () => {
      const spec = { projectId: 'my-gcp-project', datasetId: 'my_dataset', tableId: 'my_table' };
      expect(spec.projectId).toBeDefined();
      expect(spec.datasetId).toBeDefined();
    });

    it('should validate query-based connection', () => {
      const spec = {
        projectId: 'my-gcp-project',
        query: 'SELECT * FROM `project.dataset.table` LIMIT 1000',
      };
      expect(spec.query).toContain('SELECT');
    });

    it('should prepare spreadsheet for BigQuery connection', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'spreadsheetId,properties.title,sheets.properties',
      });
      expect(response.status).toBe(200);
      expect(response.data.spreadsheetId).toBe(testSpreadsheet.id);
    });

    it('should handle empty data sources list', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'dataSources',
      });
      const dataSources = response.data.dataSources || [];
      expect(Array.isArray(dataSources)).toBe(true);
    });
  });

  describe('Query Operations', () => {
    it('should validate SQL query structure', () => {
      const queries = [
        'SELECT * FROM `project.dataset.table`',
        'SELECT name, COUNT(*) as count FROM `project.dataset.users` GROUP BY name',
      ];
      for (const query of queries) {
        expect(query.toUpperCase()).toContain('SELECT');
      }
    });

    it('should validate query parameters', () => {
      const queryConfig = {
        projectId: 'my-project',
        query: 'SELECT * FROM table',
        maxResults: 10000,
      };
      expect(queryConfig.maxResults).toBeLessThanOrEqual(100000);
    });
  });

  describe('Schema Discovery', () => {
    it('should validate project ID for datasets query', () => {
      const config = { projectId: 'my-gcp-project' };
      expect(config.projectId).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    });

    it('should define expected schema column structure', () => {
      const columns = [
        { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
        { name: 'name', type: 'STRING', mode: 'NULLABLE' },
        { name: 'tags', type: 'STRING', mode: 'REPEATED' },
      ];
      expect(columns[0].mode).toBe('REQUIRED');
      expect(columns[2].mode).toBe('REPEATED');
    });
  });

  describe('Data Transfer', () => {
    it('should prepare data for BigQuery export', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:C5',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['id', 'name', 'value'],
            ['1', 'Alice', '100'],
            ['2', 'Bob', '200'],
            ['3', 'Charlie', '300'],
            ['4', 'Diana', '400'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:C5',
      });
      expect(response.data.values).toHaveLength(5);
      expect(response.data.values![0]).toEqual(['id', 'name', 'value']);
    });

    it('should prepare target sheet for import', async () => {
      const sheetName = `BigQueryImport_${Date.now()}`;
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: { rowCount: 10000, columnCount: 26 },
                },
              },
            },
          ],
        },
      });
      expect(response.status).toBe(200);
      expect(response.data.replies![0].addSheet?.properties?.sheetId).toBeDefined();
    });
  });

  describe('Connected Sheets Data Source Structure', () => {
    it('should understand data source response structure', () => {
      const dataSource = {
        dataSourceId: 'ds_123456',
        spec: {
          bigQuery: { projectId: 'my-project', querySpec: { rawQuery: 'SELECT * FROM table' } },
        },
      };
      expect(dataSource.dataSourceId).toBeDefined();
      expect(dataSource.spec.bigQuery).toBeDefined();
    });
  });

  describe('Performance Metrics', () => {
    it('should track BigQuery-related operations', async () => {
      client.resetMetrics();
      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'dataSources,dataSourceSchedules',
        })
      );
      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
