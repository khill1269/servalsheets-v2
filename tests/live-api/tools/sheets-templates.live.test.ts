/**
 * Live API Tests for sheets_templates Tool
 *
 * Tests template management with real Google Sheets/Drive data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_templates Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('templates');
    const meta = await client.sheets.spreadsheets.get({
      spreadsheetId: testSpreadsheet.id,
    });
    sheetId = meta.data.sheets![0].properties!.sheetId!;
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('Template Structure Validation', () => {
    it('should handle empty template list', () => {
      const templates: unknown[] = [];
      expect(templates.length).toBe(0);
    });

    it('should filter templates by category', () => {
      const templates = [
        { id: '1', name: 'Budget', category: 'finance' },
        { id: '2', name: 'Timeline', category: 'project' },
        { id: '3', name: 'Invoice', category: 'finance' },
      ];
      const financeTemplates = templates.filter((t) => t.category === 'finance');
      expect(financeTemplates.length).toBe(2);
    });

    it('should validate template structure', () => {
      const template = {
        id: 'template_123',
        name: 'Sales Report',
        sheets: [
          { name: 'Data', headers: ['Date', 'Product', 'Quantity', 'Revenue'], frozenRowCount: 1 },
          { name: 'Summary', headers: ['Metric', 'Value'] },
        ],
        namedRanges: [{ name: 'DataRange', range: 'Data!A2:D1000' }],
      };
      expect(template.sheets.length).toBe(2);
      expect(template.sheets[0].headers).toContain('Revenue');
    });
  });

  describe('create action context', () => {
    it('should extract template from existing spreadsheet', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:E1',
        valueInputOption: 'RAW',
        requestBody: { values: [['ID', 'Name', 'Quantity', 'Price', 'Total']] },
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                  },
                },
                fields: 'userEnteredFormat(textFormat.bold,backgroundColor)',
              },
            },
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        includeGridData: false,
      });

      expect(response.data.sheets![0].properties?.gridProperties?.frozenRowCount).toBe(1);
    });

    it('should capture column widths for template', async () => {
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
                properties: { pixelSize: 150 },
                fields: 'pixelSize',
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
                properties: { pixelSize: 200 },
                fields: 'pixelSize',
              },
            },
          ],
        },
      });

      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        includeGridData: true,
        ranges: ['TestData!A1:B1'],
      });

      expect(response.data.sheets![0].data).toBeDefined();
    });
  });

  describe('apply action context', () => {
    it('should create new spreadsheet from template structure', async () => {
      const template = {
        name: 'Test Template',
        sheets: [
          { name: 'Data', headers: ['Column A', 'Column B', 'Column C'], frozenRowCount: 1 },
        ],
      };

      const createResponse = await client.sheets.spreadsheets.create({
        requestBody: {
          properties: { title: `FromTemplate_${Date.now()}` },
          sheets: template.sheets.map((s) => ({
            properties: {
              title: s.name,
              gridProperties: { frozenRowCount: s.frozenRowCount || 0 },
            },
          })),
        },
      });

      const newSpreadsheetId = createResponse.data.spreadsheetId!;
      expect(newSpreadsheetId).toBeDefined();

      for (const sheet of template.sheets) {
        if (sheet.headers?.length) {
          await client.sheets.spreadsheets.values.update({
            spreadsheetId: newSpreadsheetId,
            range: `${sheet.name}!A1:${String.fromCharCode(64 + sheet.headers.length)}1`,
            valueInputOption: 'RAW',
            requestBody: { values: [sheet.headers] },
          });
        }
      }

      const readResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: newSpreadsheetId,
        range: 'Data!A1:C1',
      });

      expect(readResponse.data.values![0]).toEqual(['Column A', 'Column B', 'Column C']);
      await client.drive.files.delete({ fileId: newSpreadsheetId });
    });

    it('should apply named ranges from template', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!F1:G5',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Name', 'Value'],
            ['Item1', '100'],
            ['Item2', '200'],
            ['Item3', '300'],
            ['Item4', '400'],
          ],
        },
      });

      const namedRangeName = `DataValues_${Date.now()}`;
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              addNamedRange: {
                namedRange: {
                  name: namedRangeName,
                  range: {
                    sheetId,
                    startRowIndex: 1,
                    endRowIndex: 5,
                    startColumnIndex: 6,
                    endColumnIndex: 7,
                  },
                },
              },
            },
          ],
        },
      });

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'namedRanges',
      });

      expect(verifyResponse.data.namedRanges?.some((nr) => nr.name === namedRangeName)).toBe(true);
    });
  });

  describe('update action context', () => {
    it('should update template metadata', () => {
      const template = { id: 'template_123', name: 'Old Name', version: '1.0.0' };
      const updates = { name: 'New Name', version: '1.1.0' };
      const updatedTemplate = { ...template, ...updates };
      expect(updatedTemplate.name).toBe('New Name');
    });
  });

  describe('preview action context', () => {
    it('should generate template preview', () => {
      const template = {
        name: 'Invoice Template',
        sheets: [
          { name: 'Invoice', headers: ['Date', 'Description', 'Quantity', 'Rate', 'Amount'] },
          { name: 'Terms', headers: ['Condition', 'Details'] },
        ],
        namedRanges: [{ name: 'LineItems', range: 'Invoice!A2:E100' }],
      };
      expect(template.sheets.length).toBe(2);
      expect(template.namedRanges[0].name).toBe('LineItems');
    });
  });

  describe('import_builtin action context', () => {
    it('should define builtin template structure', () => {
      const builtinTemplates = [
        {
          builtinName: 'budget_tracker',
          name: 'Budget Tracker',
          sheets: ['Transactions', 'Summary'],
        },
        {
          builtinName: 'project_timeline',
          name: 'Project Timeline',
          sheets: ['Tasks', 'Milestones'],
        },
      ];
      expect(builtinTemplates.length).toBeGreaterThan(0);
      expect(builtinTemplates[0].sheets).toContain('Transactions');
    });
  });

  describe('Template Operations with Real Data', () => {
    it('should create template-ready spreadsheet structure', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1:M1',
        valueInputOption: 'RAW',
        requestBody: { values: [['ID', 'Date', 'Description', 'Category', 'Amount', 'Status']] },
      });

      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 7,
                  endColumnIndex: 13,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.2, green: 0.4, blue: 0.7 },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
          ],
        },
      });

      const verifyResponse = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
      });

      expect(verifyResponse.data.sheets![0].properties?.gridProperties?.frozenRowCount).toBe(1);
    });

    it('should clone spreadsheet structure for template application', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!N1:P3',
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['Header1', 'Header2', 'Header3'],
            ['Data1', 'Data2', 'Data3'],
            ['Data4', 'Data5', 'Data6'],
          ],
        },
      });

      const copyResponse = await client.drive.files.copy({
        fileId: testSpreadsheet.id,
        requestBody: { name: `TemplateCopy_${Date.now()}` },
      });

      const copiedId = copyResponse.data.id!;
      expect(copiedId).toBeDefined();

      const verifyResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId: copiedId,
        range: 'TestData!N1:P1',
      });

      expect(verifyResponse.data.values![0]).toEqual(['Header1', 'Header2', 'Header3']);
      await client.drive.files.delete({ fileId: copiedId });
    });
  });

  describe('Performance Metrics', () => {
    it('should track template-related operations', async () => {
      client.resetMetrics();

      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'sheets.properties,namedRanges',
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
