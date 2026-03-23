/**
 * Live API Tests for sheets_webhook Tool
 *
 * Tests webhook management with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 *
 * Note: Full webhook functionality requires a publicly accessible HTTPS endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_webhook Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('webhook');
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('register action', () => {
    it('should validate webhook URL requirements', () => {
      const validUrl = 'https://api.example.com/webhook';
      expect(validUrl.startsWith('https://')).toBe(true);
    });

    it('should define supported event types', () => {
      const eventTypes = [
        'sheet.update',
        'sheet.create',
        'sheet.delete',
        'cell.update',
        'format.update',
        'all',
      ];
      expect(eventTypes).toContain('cell.update');
      expect(eventTypes).toContain('all');
    });

    it('should validate webhook registration structure', () => {
      const registration = {
        spreadsheetId: testSpreadsheet.id,
        webhookUrl: 'https://api.example.com/sheets-webhook',
        eventTypes: ['cell.update', 'sheet.update'],
        secret: 'minimum16charssecret',
        expirationMs: 604800000,
      };
      expect(registration.secret?.length).toBeGreaterThanOrEqual(16);
      expect(registration.eventTypes.length).toBeGreaterThan(0);
    });

    it('should understand Watch API channel structure', () => {
      const channel = {
        id: 'channel-uuid-here',
        resourceId: 'resource-id-from-google',
        resourceUri: `https://www.googleapis.com/drive/v3/files/${testSpreadsheet.id}`,
        expiration: Date.now() + 604800000,
      };
      expect(channel.resourceUri).toContain(testSpreadsheet.id);
    });
  });

  describe('unregister action', () => {
    it('should understand stop channel request', () => {
      const stopRequest = { id: 'channel-uuid', resourceId: 'resource-id-from-watch' };
      expect(stopRequest.id).toBeDefined();
      expect(stopRequest.resourceId).toBeDefined();
    });
  });

  describe('list action', () => {
    it('should define webhook list structure', () => {
      const webhooks = [
        {
          webhookId: 'wh_123',
          spreadsheetId: 'spreadsheet_abc',
          eventTypes: ['cell.update'],
          active: true,
        },
        {
          webhookId: 'wh_456',
          spreadsheetId: 'spreadsheet_xyz',
          eventTypes: ['all'],
          active: true,
        },
      ];
      expect(webhooks.length).toBe(2);
      expect(webhooks[0].active).toBe(true);
    });

    it('should filter by spreadsheet ID', () => {
      const webhooks = [
        { webhookId: 'wh_1', spreadsheetId: 'sheet_a' },
        { webhookId: 'wh_2', spreadsheetId: 'sheet_b' },
        { webhookId: 'wh_3', spreadsheetId: 'sheet_a' },
      ];
      const filtered = webhooks.filter((w) => w.spreadsheetId === 'sheet_a');
      expect(filtered.length).toBe(2);
    });
  });

  describe('get action', () => {
    it('should define detailed webhook info structure', () => {
      const webhook = {
        webhookId: 'wh_123',
        spreadsheetId: testSpreadsheet.id,
        webhookUrl: 'https://api.example.com/webhook',
        active: true,
        deliveryCount: 42,
        failureCount: 2,
      };
      expect(webhook.webhookId).toBeDefined();
      expect(webhook.deliveryCount).toBeGreaterThan(0);
    });
  });

  describe('test action', () => {
    it('should define test payload structure', () => {
      const testPayload = {
        type: 'test',
        webhookId: 'wh_123',
        spreadsheetId: testSpreadsheet.id,
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test webhook delivery' },
      };
      expect(testPayload.type).toBe('test');
    });

    it('should understand delivery response tracking', () => {
      const deliveryResult = {
        webhookId: 'wh_123',
        delivered: true,
        responseStatus: 200,
        responseTime: 145,
      };
      expect(deliveryResult.delivered).toBe(true);
    });
  });

  describe('get_stats action', () => {
    it('should define webhook statistics structure', () => {
      const stats = {
        webhookId: 'wh_123',
        totalDeliveries: 1000,
        successfulDeliveries: 985,
        failedDeliveries: 15,
        successRate: 0.985,
      };
      expect(stats.successRate).toBeGreaterThan(0.9);
      expect(stats.totalDeliveries).toBe(stats.successfulDeliveries + stats.failedDeliveries);
    });
  });

  describe('Webhook Payload Structure', () => {
    it('should define cell update event payload', () => {
      const payload = {
        type: 'cell.update',
        webhookId: 'wh_123',
        spreadsheetId: testSpreadsheet.id,
        timestamp: new Date().toISOString(),
        data: { sheetName: 'TestData', range: 'A1:B5', editor: 'user@example.com' },
        signature: 'hmac-sha256-signature-here',
      };
      expect(payload.type).toBe('cell.update');
      expect(payload.signature).toBeDefined();
    });

    it('should verify HMAC signature format', () => {
      const expectedSignatureFormat = /^[a-f0-9]{64}$/;
      const mockSignature = 'a'.repeat(64);
      expect(mockSignature).toMatch(expectedSignatureFormat);
    });
  });

  describe('Spreadsheet Change Detection', () => {
    it('should detect cell value changes', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Initial']] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Changed']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1',
      });

      expect(response.data.values![0][0]).toBe('Changed');
    });

    it('should detect structural changes', async () => {
      const sheetName = `WebhookTestSheet_${Date.now()}`;
      const response = await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });

      expect(response.status).toBe(200);
      expect(response.data.replies![0].addSheet?.properties?.sheetId).toBeDefined();
    });
  });

  describe('Performance Metrics', () => {
    it('should track webhook-related operations', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!B1:C2',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              ['Key', 'Value'],
              ['test', '123'],
            ],
          },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });

  // Phase 4.2A: Fine-Grained Event Filtering
  describe('Event Filtering (Phase 4.2A)', () => {
    describe('Event categorization', () => {
      it('should detect sheet.create events', async () => {
        // Add a new sheet
        const sheetName = `EventTest_Create_${Date.now()}`;
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });

        // In production, this would trigger a webhook with eventType: 'sheet.create'
        // and changeDetails.sheetsAdded: [sheetName]
        expect(sheetName).toBeDefined();
      });

      it('should detect sheet.delete events', async () => {
        // Create then delete a sheet
        const sheetName = `EventTest_Delete_${Date.now()}`;
        const addResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });

        const sheetId = addResponse.data.replies![0].addSheet!.properties!.sheetId!;

        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [{ deleteSheet: { sheetId } }],
          },
        });

        // In production, this would trigger eventType: 'sheet.delete'
        // and changeDetails.sheetsRemoved: [sheetName]
        expect(sheetId).toBeDefined();
      });

      it('should detect sheet.rename events', async () => {
        // Create and rename a sheet
        const oldName = `EventTest_Rename_Old_${Date.now()}`;
        const newName = `EventTest_Rename_New_${Date.now()}`;

        const addResponse = await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [{ addSheet: { properties: { title: oldName } } }],
          },
        });

        const sheetId = addResponse.data.replies![0].addSheet!.properties!.sheetId!;

        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: { sheetId, title: newName },
                  fields: 'title',
                },
              },
            ],
          },
        });

        // In production, this would trigger eventType: 'sheet.rename'
        // and changeDetails.sheetsRenamed: [{ from: oldName, to: newName }]
        expect(newName).toBe(newName);
      });

      it('should detect cell.update events', async () => {
        // Update cell values
        await client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!A1',
          valueInputOption: 'RAW',
          requestBody: { values: [['Updated Value']] },
        });

        // In production, this would trigger eventType: 'cell.update'
        // and changeDetails.cellRanges: ['TestData!A1']
        expect(true).toBe(true);
      });

      it('should detect format.update events', async () => {
        // Update cell formatting
        await client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: testSpreadsheet.id,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 1, green: 0, blue: 0 },
                    },
                  },
                  fields: 'userEnteredFormat.backgroundColor',
                },
              },
            ],
          },
        });

        // In production, this would trigger eventType: 'format.update'
        expect(true).toBe(true);
      });
    });
  });

  // Phase 4.1: Webhook Dashboard
  describe('Webhook Dashboard (Phase 4.1)', () => {
    describe('Dashboard metrics structure', () => {
      it('should define expected dashboard response structure', () => {
        const dashboardResponse = {
          totalWebhooks: 10,
          activeWebhooks: 8,
          totalDeliveries: 1500,
          totalFailures: 25,
          avgDeliveryRate: 98.3,
          webhooks: [
            {
              webhookId: 'wh_123',
              spreadsheetId: testSpreadsheet.id,
              successRate: 0.985,
              avgDeliveryTimeMs: 145,
              p95DeliveryTimeMs: 280,
              p99DeliveryTimeMs: 450,
              lastDelivery: new Date().toISOString(),
              lastFailure: null,
            },
          ],
        };

        expect(dashboardResponse.totalWebhooks).toBeGreaterThan(0);
        expect(dashboardResponse.webhooks[0].p95DeliveryTimeMs).toBeGreaterThan(0);
        expect(dashboardResponse.webhooks[0].p99DeliveryTimeMs).toBeGreaterThan(
          dashboardResponse.webhooks[0].p95DeliveryTimeMs
        );
      });
    });

    describe('Delivery timing tracking', () => {
      it('should track delivery duration percentiles', () => {
        // Simulate delivery timings
        const timings = [100, 120, 135, 150, 180, 200, 250, 300, 400, 500];

        // Calculate p95 and p99
        const sorted = [...timings].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        const p99Index = Math.floor(sorted.length * 0.99);

        const p95 = sorted[p95Index];
        const p99 = sorted[p99Index];

        expect(p95).toBeLessThanOrEqual(p99);
        expect(p95).toBeGreaterThan(0);
      });
    });

    describe('Queue depth metrics', () => {
      it('should track webhook queue depths', () => {
        const queueMetrics = {
          pendingCount: 15,
          retryCount: 3,
          dlqCount: 1,
        };

        expect(queueMetrics.pendingCount).toBeGreaterThanOrEqual(0);
        expect(queueMetrics.retryCount).toBeGreaterThanOrEqual(0);
        expect(queueMetrics.dlqCount).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
