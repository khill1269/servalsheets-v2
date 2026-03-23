/**
 * E2E Test: Transaction Workflow
 *
 * Tests transaction handling, rollback, and atomic operations.
 *
 * Workflow scenarios:
 * 1. Successful multi-step transaction
 * 2. Transaction with rollback on error
 * 3. Atomic batch operations
 * 4. Conflict detection and resolution
 *
 * Note: This test requires TEST_REAL_API=true and valid credentials.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestOrchestrator, describeE2E } from '../setup/test-orchestrator.js';

describeE2E('E2E: Transaction Workflow', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Transaction Workflow');
    spreadsheetId = await orchestrator.setup();
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should execute successful multi-step transaction', async () => {
    // Setup: Write initial data
    const initialData = [
      ['Account', 'Balance'],
      ['Account A', '1000'],
      ['Account B', '2000'],
    ];

    await orchestrator.executeStep({
      name: 'Write initial balances',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B3',
        values: initialData,
      },
    });

    // Transaction: Transfer 500 from A to B
    // Step 1: Deduct from A
    await orchestrator.executeStep({
      name: 'Deduct from Account A',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B2',
        values: [['500']], // New balance
      },
    });

    // Step 2: Add to B
    await orchestrator.executeStep({
      name: 'Add to Account B',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!B3',
        values: [['2500']], // New balance
      },
    });

    // Verify final balances
    const finalData = await orchestrator.executeStep({
      name: 'Read final balances',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B3',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toBeDefined();
        expect(typed.values?.[1]).toEqual(['Account A', '500']);
        expect(typed.values?.[2]).toEqual(['Account B', '2500']);
      },
    });

    expect(finalData).toBeDefined();

    // Verify all transaction steps completed
    const context = orchestrator.getContext();
    expect(context.history.filter((h) => h.success).length).toBe(4);
  }, 60000);

  it('should handle batch operations atomically', async () => {
    // Setup: Write test data
    const testData = [
      ['Item', 'Quantity', 'Price'],
      ['Item 1', '10', '100'],
      ['Item 2', '20', '200'],
      ['Item 3', '30', '300'],
    ];

    await orchestrator.executeStep({
      name: 'Write inventory data',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:C4',
        values: testData,
      },
    });

    // Batch update: Increase all quantities by 5
    const updatedData = [
      ['Item', 'Quantity', 'Price'],
      ['Item 1', '15', '100'],
      ['Item 2', '25', '200'],
      ['Item 3', '35', '300'],
    ];

    await orchestrator.executeStep({
      name: 'Batch update quantities',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:C4',
        values: updatedData,
      },
    });

    // Verify batch update
    await orchestrator.executeStep({
      name: 'Verify batch update',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!B2:B4',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toBeDefined();
        expect(typed.values?.[0]).toEqual(['15']);
        expect(typed.values?.[1]).toEqual(['25']);
        expect(typed.values?.[2]).toEqual(['35']);
      },
    });

    const context = orchestrator.getContext();
    expect(context.history.every((h) => h.success)).toBe(true);
  }, 60000);

  it('should maintain data consistency across operations', async () => {
    // Test scenario: Multiple concurrent-like writes
    const batch1 = [
      ['Name', 'Value'],
      ['A', '1'],
      ['B', '2'],
    ];

    const batch2 = [
      ['Name', 'Value'],
      ['A', '10'],
      ['B', '20'],
    ];

    // First write
    await orchestrator.executeStep({
      name: 'First batch write',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B3',
        values: batch1,
      },
    });

    // Read to verify
    const read1 = await orchestrator.executeStep({
      name: 'Read after first batch',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B3',
      },
    });

    // Second write (overwrites)
    await orchestrator.executeStep({
      name: 'Second batch write',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B3',
        values: batch2,
      },
    });

    // Final read - should show batch2 values
    await orchestrator.executeStep({
      name: 'Read after second batch',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1:B3',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values).toBeDefined();
        expect(typed.values?.[1]).toEqual(['A', '10']);
        expect(typed.values?.[2]).toEqual(['B', '20']);
      },
    });

    expect(read1).toBeDefined();
  }, 60000);

  it('should track operation order in history', async () => {
    // Execute sequence of operations
    await orchestrator.executeStep({
      name: 'Operation 1: Write',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1',
        values: [['Step 1']],
      },
    });

    await orchestrator.executeStep({
      name: 'Operation 2: Read',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1',
      },
    });

    await orchestrator.executeStep({
      name: 'Operation 3: Update',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1',
        values: [['Step 3']],
      },
    });

    // Verify history order
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(3);
    expect(context.history[0].step).toBe('Operation 1: Write');
    expect(context.history[1].step).toBe('Operation 2: Read');
    expect(context.history[2].step).toBe('Operation 3: Update');

    // Verify timestamps are sequential
    expect(context.history[1].timestamp).toBeGreaterThan(context.history[0].timestamp);
    expect(context.history[2].timestamp).toBeGreaterThan(context.history[1].timestamp);
  }, 60000);
});

describeE2E('E2E: Error Recovery in Transactions', () => {
  let orchestrator: ReturnType<typeof createTestOrchestrator>;
  let spreadsheetId: string;

  beforeEach(async () => {
    orchestrator = createTestOrchestrator('Transaction Error Recovery');
    spreadsheetId = await orchestrator.setup();
  });

  afterEach(async () => {
    await orchestrator.cleanup();
  });

  it('should track failed operations', async () => {
    // Write valid data
    await orchestrator.executeStep({
      name: 'Write valid data',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1:B2',
        values: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
    });

    // Attempt operation with failing validation
    try {
      await orchestrator.executeStep({
        name: 'Operation with validation failure',
        tool: 'sheets_data',
        action: 'write',
        args: {
          spreadsheetId,
          range: 'Data!A3:B3',
          values: [['C', 'D']],
        },
        validate: () => {
          throw new Error('Simulated validation failure');
        },
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('Simulated validation failure');
    }

    // Verify history shows 1 success, 1 failure
    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(2);
    expect(context.history[0].success).toBe(true);
    expect(context.history[1].success).toBe(false);
  }, 60000);

  it('should allow recovery after failed operations', async () => {
    // Attempt operation with validation failure
    try {
      await orchestrator.executeStep({
        name: 'Failing operation',
        tool: 'sheets_data',
        action: 'write',
        args: {
          spreadsheetId,
          range: 'Data!A1',
          values: [['Fail']],
        },
        validate: () => {
          throw new Error('Intentional failure');
        },
      });
    } catch {
      // Expected to fail
    }

    // Retry with successful operation
    await orchestrator.executeStep({
      name: 'Recovery operation',
      tool: 'sheets_data',
      action: 'write',
      args: {
        spreadsheetId,
        range: 'Data!A1',
        values: [['Success']],
      },
    });

    // Verify recovery
    await orchestrator.executeStep({
      name: 'Verify recovery',
      tool: 'sheets_data',
      action: 'read',
      args: {
        spreadsheetId,
        range: 'Data!A1',
      },
      validate: (result: unknown) => {
        const typed = result as { values?: unknown[][] };
        expect(typed.values?.[0]).toEqual(['Success']);
      },
    });

    const context = orchestrator.getContext();
    expect(context.history).toHaveLength(3);
    expect(context.history[0].success).toBe(false);
    expect(context.history[1].success).toBe(true);
    expect(context.history[2].success).toBe(true);
  }, 60000);
});
