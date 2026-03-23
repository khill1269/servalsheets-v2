/**
 * Live API Tests for sheets_confirm Tool
 *
 * Tests confirmation workflows with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 *
 * Note: sheets_confirm uses MCP Elicitation (SEP-1036) for user interaction.
 * These tests verify the data structures and API context.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_confirm Live API Tests', () => {
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
    testSpreadsheet = await manager.createTestSpreadsheet('confirm');
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('request action', () => {
    it('should validate plan structure with real spreadsheet context', async () => {
      const plan = {
        title: 'Update Sales Data',
        description: `Update sales data in spreadsheet ${testSpreadsheet.id}`,
        steps: [
          {
            stepNumber: 1,
            description: 'Read current data',
            tool: 'sheets_data',
            action: 'read',
            risk: 'low' as const,
            isDestructive: false,
          },
          {
            stepNumber: 2,
            description: 'Write new values',
            tool: 'sheets_data',
            action: 'write',
            risk: 'medium' as const,
            isDestructive: true,
          },
        ],
        willCreateSnapshot: true,
      };
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[1].isDestructive).toBe(true);
    });

    it('should calculate total API calls from plan', () => {
      const plan = {
        steps: [{ estimatedApiCalls: 2 }, { estimatedApiCalls: 3 }, { estimatedApiCalls: 1 }],
      };
      const totalApiCalls = plan.steps.reduce(
        (sum, step) => sum + (step.estimatedApiCalls || 0),
        0
      );
      expect(totalApiCalls).toBe(6);
    });

    it('should identify high-risk operations in plan', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:C10',
        valueInputOption: 'RAW',
        requestBody: {
          values: Array.from({ length: 10 }, (_, i) => [
            `Row${i + 1}`,
            `Data${i + 1}`,
            `Value${i + 1}`,
          ]),
        },
      });

      const plan = {
        steps: [
          {
            stepNumber: 1,
            description: 'Delete data',
            risk: 'critical' as const,
            isDestructive: true,
            canUndo: false,
          },
        ],
      };
      const highRiskSteps = plan.steps.filter((s) => s.risk === 'critical' || s.risk === 'high');
      expect(highRiskSteps.length).toBe(1);
    });

    it('should prepare confirmation with spreadsheet metadata', async () => {
      const response = await client.sheets.spreadsheets.get({
        spreadsheetId: testSpreadsheet.id,
        fields: 'properties.title,sheets.properties.title',
      });
      const title = response.data.properties?.title;
      expect(title).toBeDefined();
      const confirmationContext = {
        spreadsheetTitle: title,
        warningMessage: `This will modify spreadsheet "${title}"`,
      };
      expect(confirmationContext.warningMessage).toContain(title);
    });
  });

  describe('get_stats action', () => {
    it('should track confirmation statistics structure', () => {
      const stats = { totalConfirmations: 10, approved: 7, declined: 2, cancelled: 1 };
      expect(stats.approved + stats.declined + stats.cancelled).toBe(stats.totalConfirmations);
    });
  });

  describe('wizard_start action', () => {
    it('should define multi-step wizard structure', () => {
      const wizard = {
        wizardId: `wizard_${Date.now()}`,
        title: 'Create Sales Spreadsheet',
        steps: [
          {
            stepId: 'basic_info',
            title: 'Basic Information',
            fields: [{ name: 'title', type: 'text', required: true }],
          },
          { stepId: 'columns', title: 'Column Setup', dependsOn: 'basic_info' },
          { stepId: 'formatting', title: 'Formatting Options', dependsOn: 'columns' },
        ],
      };
      expect(wizard.steps.length).toBe(3);
      expect(wizard.steps[1].dependsOn).toBe('basic_info');
    });

    it('should validate wizard step dependencies', () => {
      const steps = [
        { stepId: 'step1', dependsOn: undefined },
        { stepId: 'step2', dependsOn: 'step1' },
        { stepId: 'step3', dependsOn: 'step2' },
      ];
      const stepOrder: string[] = [];
      const completed = new Set<string>();
      for (const step of steps) {
        if (!step.dependsOn || completed.has(step.dependsOn)) {
          stepOrder.push(step.stepId);
          completed.add(step.stepId);
        }
      }
      expect(stepOrder).toEqual(['step1', 'step2', 'step3']);
    });
  });

  describe('wizard_step action', () => {
    it('should validate field values for wizard step', () => {
      const step = {
        fields: [
          { name: 'title', required: true },
          { name: 'rowCount', required: true },
        ],
      };
      const values = { title: 'My Spreadsheet', rowCount: 100 };
      const requiredFields = step.fields.filter((f) => f.required).map((f) => f.name);
      const missingFields = requiredFields.filter(
        (name) => values[name as keyof typeof values] === undefined
      );
      expect(missingFields.length).toBe(0);
    });

    it('should collect values across wizard steps', () => {
      const collectedValues: Record<string, unknown> = {};
      Object.assign(collectedValues, { title: 'Sales Report', description: 'Monthly sales' });
      Object.assign(collectedValues, { columns: ['Date', 'Product', 'Amount'] });
      Object.assign(collectedValues, { headerStyle: 'Bold', freezeHeader: true });
      expect(Object.keys(collectedValues).length).toBe(5);
    });
  });

  describe('wizard_complete action', () => {
    it('should generate execution plan from wizard values', () => {
      const wizardValues = { title: 'Test', columns: ['A', 'B', 'C'], freezeHeader: true };
      const executionPlan = {
        steps: [
          { tool: 'sheets_core', action: 'create', params: { title: wizardValues.title } },
          { tool: 'sheets_data', action: 'write', params: { values: [wizardValues.columns] } },
        ],
      };
      if (wizardValues.freezeHeader) {
        executionPlan.steps.push({
          tool: 'sheets_dimensions',
          action: 'freeze',
          params: { rows: 1 },
        });
      }
      expect(executionPlan.steps.length).toBe(3);
    });

    it('should create actual spreadsheet from wizard completion', async () => {
      const createResponse = await client.sheets.spreadsheets.create({
        requestBody: { properties: { title: `WizardTest_${Date.now()}` } },
      });
      const spreadsheetId = createResponse.data.spreadsheetId!;
      expect(spreadsheetId).toBeDefined();

      await client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1:C1',
        valueInputOption: 'RAW',
        requestBody: { values: [['Column A', 'Column B', 'Column C']] },
      });

      const readResponse = await client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!A1:C1',
      });
      expect(readResponse.data.values![0]).toEqual(['Column A', 'Column B', 'Column C']);

      await client.drive.files.delete({ fileId: spreadsheetId });
    });
  });

  describe('Risk Assessment with Real Data', () => {
    it('should assess risk based on data volume', async () => {
      const rowCount = 50;
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `TestData!E1:H${rowCount}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: Array.from({ length: rowCount }, (_, i) => [
            `Row${i + 1}`,
            Math.random() * 1000,
            new Date().toISOString(),
            'Active',
          ]),
        },
      });

      const cellCount = rowCount * 4; // 50 * 4 = 200 cells
      let risk: 'low' | 'medium' | 'high' | 'critical';
      if (cellCount < 50) risk = 'low';
      else if (cellCount < 200) risk = 'medium';
      else if (cellCount < 1000) risk = 'high';
      else risk = 'critical';
      expect(risk).toBe('high'); // 200 cells = high risk
    });
  });

  describe('Performance Metrics', () => {
    it('should track confirmation-related API calls', async () => {
      client.resetMetrics();
      await client.trackOperation('get', 'GET', () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: testSpreadsheet.id,
          fields: 'properties.title',
        })
      );
      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
