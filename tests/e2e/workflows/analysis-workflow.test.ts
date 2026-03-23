/**
 * E2E Test: Analysis Workflow
 *
 * Tests the complete analysis pipeline from spreadsheet creation to insights.
 *
 * Workflow steps:
 * 1. Create test spreadsheet
 * 2. Populate with sample data (1000 rows)
 * 3. Read data back to verify
 * 4. Perform quick analysis
 * 5. Perform comprehensive analysis
 * 6. Verify analysis results
 * 7. Cleanup
 *
 * Note: This test requires TEST_REAL_API=true and valid credentials.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  createTestOrchestrator,
  describeE2E,
  type WorkflowContext,
} from '../setup/test-orchestrator.js';

/**
 * Generate test data for population
 */
function generateTestData(rows: number, cols: number): unknown[][] {
  const data: unknown[][] = [];

  // Header row
  const headers = Array.from({ length: cols }, (_, i) => `Column ${String.fromCharCode(65 + i)}`);
  data.push(headers);

  // Data rows
  for (let row = 1; row <= rows; row++) {
    const rowData: unknown[] = [];
    for (let col = 0; col < cols; col++) {
      // Mix of data types
      if (col === 0) {
        rowData.push(`Item ${row}`);
      } else if (col === 1) {
        rowData.push(Math.floor(Math.random() * 1000));
      } else if (col === 2) {
        rowData.push((Math.random() * 100).toFixed(2));
      } else {
        rowData.push(`Value ${row}-${col}`);
      }
    }
    data.push(rowData);
  }

  return data;
}

describeE2E('E2E: Analysis Workflow', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Analysis Workflow');
    spreadsheetId = await orchestrator.setup();
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should complete full analysis pipeline', async () => {
    // Step 1: Populate with sample data (100 rows for faster tests)
    const testData = generateTestData(100, 5);

    const writeResult = await orchestrator.executeStep({
      name: 'Populate test data',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:E101',
        values: testData,
        valueInputOption: 'USER_ENTERED',
      },
      validate: (result: unknown) => {
        const typed = result as { success: boolean; updatedCells?: number };
        expect(typed.success).toBe(true);
        expect(typed.updatedCells).toBeGreaterThan(0);
      },
    });

    expect(writeResult).toBeDefined();

    // Step 2: Read data back to verify
    const readResult = await orchestrator.executeStep({
      name: 'Read data back',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:E101',
      },
      validate: (result: unknown) => {
        const typed = result as { success: boolean; values?: unknown[][] };
        expect(typed.success).toBe(true);
        expect(typed.values).toHaveLength(101); // 1 header + 100 data rows
      },
    });

    expect(readResult).toBeDefined();

    // Step 3: Perform quick analysis
    const quickAnalysisResult = await orchestrator.executeStep({
      name: 'Quick analysis',
      tool: 'sheets_analyze',
      action: 'quick',
      args: {
        spreadsheetId,
      },
      validate: (result: unknown) => {
        const typed = result as { success: boolean; analysis?: { cellsAnalyzed: number } };
        expect(typed.success).toBe(true);
        expect(typed.analysis?.cellsAnalyzed).toBeGreaterThan(0);
      },
    });

    expect(quickAnalysisResult).toBeDefined();

    // Step 4: Perform comprehensive analysis
    const comprehensiveAnalysisResult = await orchestrator.executeStep({
      name: 'Comprehensive analysis',
      tool: 'sheets_analyze',
      action: 'comprehensive',
      args: {
        spreadsheetId,
      },
      validate: (result: unknown) => {
        const typed = result as {
          success: boolean;
          analysis?: {
            quality_score: number;
            insights: string[];
          };
        };
        expect(typed.success).toBe(true);
        expect(typed.analysis?.quality_score).toBeGreaterThan(0);
        expect(typed.analysis?.insights).toBeDefined();
      },
    });

    expect(comprehensiveAnalysisResult).toBeDefined();

    // Verify workflow context
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(4); // 4 steps executed
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000); // 60s timeout for E2E test

  it('should handle large dataset analysis', async () => {
    // Test with larger dataset (500 rows)
    const testData = generateTestData(500, 10);

    await orchestrator.executeStep({
      name: 'Populate large dataset',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:J501',
        values: testData,
        valueInputOption: 'USER_ENTERED',
      },
    });

    // Analyze large dataset
    const analysisResult = await orchestrator.executeStep({
      name: 'Analyze large dataset',
      tool: 'sheets_analyze',
      action: 'comprehensive',
      args: {
        spreadsheetId,
      },
      validate: (result: unknown) => {
        const typed = result as { success: boolean; analysis?: { cellsAnalyzed: number } };
        expect(typed.success).toBe(true);
        expect(typed.analysis?.cellsAnalyzed).toBeGreaterThan(5000); // 500 rows * 10 cols
      },
    });

    expect(analysisResult).toBeDefined();
  }, 120000); // 120s timeout for large dataset

  it('should track workflow execution history', async () => {
    // Execute simple workflow
    const testData = generateTestData(10, 3);

    await orchestrator.executeStep({
      name: 'Write data',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:C11',
        values: testData,
      },
    });

    await orchestrator.executeStep({
      name: 'Read data',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:C11',
      },
    });

    // Verify history tracking
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(2);
    expect(context.history[0].step).toBe('Write data');
    expect(context.history[0].tool).toBe('sheets_data');
    expect(context.history[0].action).toBe('write');
    expect(context.history[0].success).toBe(true);
    expect(context.history[0].timestamp).toBeGreaterThan(0);

    expect(context.history[1].step).toBe('Read data');
    expect(context.history[1].tool).toBe('sheets_data');
    expect(context.history[1].action).toBe('read');
    expect(context.history[1].success).toBe(true);
  }, 30000);

  it('should handle step validation failures', async () => {
    // Execute step with failing validation
    await expect(
      orchestrator.executeStep({
        name: 'Write with invalid validation',
        tool: 'sheets_data',
        action: 'write',
        args: {
          spreadsheetId,
          range: 'Data!A1:B2',
          values: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
        validate: () => {
          throw new Error('Validation failed intentionally');
        },
      })
    ).rejects.toThrow('Validation failed intentionally');

    // Verify failure is tracked in history
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(1);
    expect(context.history[0].success).toBe(false);
  }, 30000);
});

describeE2E('E2E: Multi-Step Analysis with Formatting', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Analysis with Formatting');
    spreadsheetId = await orchestrator.setup('Analysis Test with Formatting');
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should analyze formatted data', async () => {
    // Step 1: Write data
    const testData = [
      ['Product', 'Sales', 'Revenue'],
      ['Widget A', '100', '1000'],
      ['Widget B', '200', '2000'],
      ['Widget C', '150', '1500'],
    ];

    await orchestrator.executeStep({
      name: 'Write product data',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:C4',
        values: testData,
      },
    });

    // Step 2: Format header row
    await orchestrator.executeStep({
      name: 'Format headers',
      tool: 'sheets_format',
      action: 'set_format',
      args: {
        spreadsheetId,
        range: 'Data!A1:C1',
        format: {
          backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
          textFormat: {
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
        },
      },
    });

    // Step 3: Analyze formatted data
    const analysisResult = await orchestrator.executeStep({
      name: 'Analyze formatted data',
      tool: 'sheets_analyze',
      action: 'quick',
      args: {
        spreadsheetId,
      },
    });

    expect(analysisResult).toBeDefined();

    // Verify all steps completed successfully
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(3);
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);
});
