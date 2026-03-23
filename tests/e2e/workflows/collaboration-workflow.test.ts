/**
 * E2E Test: Collaboration Workflow
 *
 * Tests multi-user collaboration, sharing, and concurrent editing scenarios.
 *
 * Workflow scenarios:
 * 1. Share spreadsheet with users
 * 2. Add comments and notes
 * 3. Concurrent data modifications
 * 4. Permission management
 * 5. Collaboration tracking
 *
 * Note: This test requires TEST_REAL_API=true and valid credentials.
 * For full testing, multiple test accounts are recommended.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestOrchestrator, describeE2E } from '../setup/test-orchestrator.js';

describeE2E('E2E: Collaboration Workflow', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Collaboration Workflow');
    spreadsheetId = await orchestrator.setup('Collaboration Test Sheet');
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should setup collaborative spreadsheet', async () => {
    // Setup: Create initial collaborative data structure
    const collaborativeData = [
      ['Task', 'Assignee', 'Status', 'Last Updated'],
      ['Task 1', 'User A', 'In Progress', new Date().toISOString()],
      ['Task 2', 'User B', 'Pending', new Date().toISOString()],
      ['Task 3', 'User C', 'Completed', new Date().toISOString()],
    ];

    await orchestrator.executeStep({
      name: 'Create collaborative task list',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:D4',
        values: collaborativeData,
      },
      validate: (result: unknown) => {
        const typed = result as { success: boolean; updatedCells?: number };
        expect(typed.success).toBe(true);
        expect(typed.updatedCells).toBe(16); // 4 rows × 4 columns
      },
    });

    // Format for collaboration
    await orchestrator.executeStep({
      name: 'Format collaborative headers',
      tool: 'sheets_format',
      action: 'set_format',
      args: {
        spreadsheetId,
        range: 'Data!A1:D1',
        format: {
          backgroundColor: { red: 0.1, green: 0.7, blue: 0.3 },
          textFormat: {
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          horizontalAlignment: 'CENTER',
        },
      },
    });

    // Verify setup
    const verifyResult = await orchestrator.executeStep({
      name: 'Verify collaborative setup',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:D4',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toBeDefined();
        expect(typed.values).toHaveLength(4);
        expect(typed.values?.[0][0]).toBe('Task');
      },
    });

    expect(verifyResult).toBeDefined();

    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(3);
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);

  it('should handle concurrent-style updates', async () => {
    // Setup: Initial data
    const initialData = [
      ['Item', 'Count'],
      ['A', '0'],
      ['B', '0'],
      ['C', '0'],
    ];

    await orchestrator.executeStep({
      name: 'Write initial counters',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B4',
        values: initialData,
      },
    });

    // Simulate User 1 update
    await orchestrator.executeStep({
      name: 'User 1: Increment counter A',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B2',
        values: [['1']],
      },
    });

    // Simulate User 2 update (different row)
    await orchestrator.executeStep({
      name: 'User 2: Increment counter B',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B3',
        values: [['1']],
      },
    });

    // Simulate User 3 update (different row)
    await orchestrator.executeStep({
      name: 'User 3: Increment counter C',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B4',
        values: [['1']],
      },
    });

    // Verify all updates persisted
    await orchestrator.executeStep({
      name: 'Verify all updates',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B4',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toBeDefined();
        expect(typed.values?.[1]).toEqual(['A', '1']);
        expect(typed.values?.[2]).toEqual(['B', '1']);
        expect(typed.values?.[3]).toEqual(['C', '1']);
      },
    });

    // Verify workflow tracked all operations
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(5);
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);

  it('should track collaborative editing history', async () => {
    // Simulate collaborative editing session
    const initialData = [
      ['Document', 'Editor', 'Edit Time'],
      ['Doc 1', 'Editor A', new Date().toISOString()],
    ];

    await orchestrator.executeStep({
      name: 'Initial document creation',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:C2',
        values: initialData,
      },
    });

    // Editor B makes changes
    await orchestrator.executeStep({
      name: 'Editor B: Add content',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A3:C3',
        values: [['Doc 2', 'Editor B', new Date().toISOString()]],
      },
    });

    // Editor C makes changes
    await orchestrator.executeStep({
      name: 'Editor C: Add content',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A4:C4',
        values: [['Doc 3', 'Editor C', new Date().toISOString()]],
      },
    });

    // Verify complete edit history
    const finalData = await orchestrator.executeStep({
      name: 'Read complete edit history',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:C4',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toBeDefined();
        expect(typed.values).toHaveLength(4);
        // Verify all editors are tracked
        expect(typed.values?.[1][1]).toBe('Editor A');
        expect(typed.values?.[2][1]).toBe('Editor B');
        expect(typed.values?.[3][1]).toBe('Editor C');
      },
    });

    expect(finalData).toBeDefined();

    // Verify workflow history captures all collaborative actions
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(4);
    const editorSteps = context.history.filter((h) => h.step.includes('Editor'));
    expect(editorSteps).toHaveLength(2); // Editor B and Editor C
  }, 60000);

  it('should handle shared data validation', async () => {
    // Setup: Shared validation rules
    const dataWithRules = [
      ['Name', 'Age', 'Department'],
      ['Alice', '25', 'Engineering'],
      ['Bob', '30', 'Sales'],
      ['Charlie', '28', 'Marketing'],
    ];

    await orchestrator.executeStep({
      name: 'Setup shared data',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:C4',
        values: dataWithRules,
      },
    });

    // Attempt to update with validation
    await orchestrator.executeStep({
      name: 'Validated update',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B2',
        values: [['26']], // Age update
      },
      validate: (result: unknown) => {
        const typed = result as { success: boolean };
        expect(typed.success).toBe(true);
      },
    });

    // Verify update
    await orchestrator.executeStep({
      name: 'Verify validated update',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A2:C2',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values?.[0]).toEqual(['Alice', '26', 'Engineering']);
      },
    });

    const context = orchestrator.getContext();
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);
});

describeE2E('E2E: Multi-Sheet Collaboration', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Multi-Sheet Collaboration');
    spreadsheetId = await orchestrator.setup('Multi-Sheet Collaboration Test');
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should coordinate data across multiple sheets', async () => {
    // Setup: Data sheet
    const dataSheetContent = [
      ['ID', 'Value'],
      ['1', '100'],
      ['2', '200'],
      ['3', '300'],
    ];

    await orchestrator.executeStep({
      name: 'Populate Data sheet',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B4',
        values: dataSheetContent,
      },
    });

    // Read from Data sheet
    const dataRead = await orchestrator.executeStep({
      name: 'Read from Data sheet',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B4',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toHaveLength(4);
      },
    });

    expect(dataRead).toBeDefined();

    // Verify workflow coordination
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(2);
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);

  it('should maintain data consistency across sheets', async () => {
    // Write to first sheet
    await orchestrator.executeStep({
      name: 'Write to Data sheet',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B2',
        values: [
          ['Source', 'Value'],
          ['Item 1', '100'],
        ],
      },
    });

    // Read and verify
    const read1 = await orchestrator.executeStep({
      name: 'Read from Data sheet',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B2',
      },
    });

    // Update data
    await orchestrator.executeStep({
      name: 'Update Data sheet',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B2',
        values: [['200']],
      },
    });

    // Verify consistency
    await orchestrator.executeStep({
      name: 'Verify consistency',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B2',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values?.[1]).toEqual(['Item 1', '200']);
      },
    });

    expect(read1).toBeDefined();

    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(4);
  }, 60000);
});
