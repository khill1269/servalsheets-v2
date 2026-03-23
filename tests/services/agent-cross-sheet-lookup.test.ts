/**
 * Tests for D1: inject_cross_sheet_lookup step type + 4 new workflow templates
 *
 * Verifies:
 * - inject_cross_sheet_lookup step is handled without error
 * - XLOOKUP formulas are written to the correct range
 * - formulasWritten count matches the row span
 * - Unknown tool/action steps still go through executeHandler (existing behavior preserved)
 * - All 4 new templates are listed and have the expected step counts
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllPlans,
  compilePlan,
  executePlan,
  listTemplates,
  type ExecuteHandlerFn,
  type PlanState,
} from '../../src/services/agent-engine.js';

afterEach(async () => {
  await clearAllPlans();
  vi.restoreAllMocks();
});

function makePlanExecutable<T extends { steps: Array<{ tool: string; action: string; params: Record<string, unknown> }> }>(
  plan: T
): T {
  for (const step of plan.steps) {
    if (step.tool === 'sheets_data' && step.action === 'read' && step.params['range'] === undefined) {
      step.params['range'] = 'Sheet1!A1:B5';
    }
    if (
      step.tool === 'sheets_data' &&
      step.action === 'write' &&
      step.params['range'] === undefined
    ) {
      step.params['range'] = 'Sheet1!A1:B2';
      step.params['values'] = [
        ['Name', 'Value'],
        ['Alice', 42],
      ];
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal plan with a single inject_cross_sheet_lookup step
// ---------------------------------------------------------------------------
function makeCrossSheetPlan(overrides?: Partial<Record<string, unknown>>): PlanState {
  const plan = compilePlan('read', 10, 'test-spreadsheet-id');
  // Replace all steps with a single inject_cross_sheet_lookup step
  plan.steps = [
    {
      stepId: 'step-lookup-1',
      tool: '__internal__',
      action: 'inject_cross_sheet_lookup',
      description: 'Inject XLOOKUP formulas',
      params: {
        spreadsheetId: 'test-spreadsheet-id',
        ...(overrides ?? {}),
      },
      config: {
        sourceSheet: 'Customers',
        lookupCol: 'A',
        returnCol: 'B',
        targetSheet: 'Orders',
        targetCol: 'E',
        targetKeyCol: 'B',
        startRow: 2,
      },
    },
  ];
  plan.currentStepIndex = 0;
  return plan;
}

describe('D1: inject_cross_sheet_lookup step type', () => {
  it('executes without error and returns formulasWritten > 0', async () => {
    const plan = makeCrossSheetPlan();

    const mockHandler = vi.fn(async (tool: string, action: string, params: Record<string, unknown>) => {
      // Scout call returns sheet info so lastRow can be computed
      if (tool === 'sheets_analyze' && action === 'scout') {
        return {
          sheets: [
            { name: 'Orders', rowCount: 5 },
            { name: 'Customers', rowCount: 3 },
          ],
        };
      }
      // Write call returns success
      if (tool === 'sheets_data' && action === 'write') {
        return { success: true, updatedCells: params['values'] ? (params['values'] as unknown[][]).length : 0 };
      }
      return { success: true };
    }) satisfies ExecuteHandlerFn;

    const result = await executePlan(plan.planId, false, mockHandler);

    expect(result.status).toBe('completed');
    expect(result.results).toHaveLength(1);
    const stepResult = result.results[0];
    expect(stepResult?.success).toBe(true);

    const data = stepResult?.result as { formulasWritten: number };
    expect(data.formulasWritten).toBeGreaterThan(0);
  });

  it('writes XLOOKUP formulas to the correct target range', async () => {
    const plan = makeCrossSheetPlan();

    let capturedWriteParams: Record<string, unknown> | null = null;

    const mockHandler = vi.fn(async (tool: string, action: string, params: Record<string, unknown>) => {
      if (tool === 'sheets_analyze' && action === 'scout') {
        return { sheets: [{ name: 'Orders', rowCount: 3 }] };
      }
      if (tool === 'sheets_data' && action === 'write') {
        capturedWriteParams = params;
        return { success: true };
      }
      return { success: true };
    }) satisfies ExecuteHandlerFn;

    await executePlan(plan.planId, false, mockHandler);

    expect(capturedWriteParams).not.toBeNull();

    // Range should target Orders!E column starting at row 2
    const range = capturedWriteParams!['range'] as string;
    expect(range).toMatch(/^Orders!E\d+:E\d+$/);

    // Values should be XLOOKUP formula strings
    const values = capturedWriteParams!['values'] as string[][];
    expect(values.length).toBeGreaterThan(0);
    expect(values[0]![0]).toContain('XLOOKUP');
    expect(values[0]![0]).toContain("'Customers'!A:A");
    expect(values[0]![0]).toContain("'Customers'!B:B");

    // valueInputOption must be USER_ENTERED so formulas are evaluated
    expect(capturedWriteParams!['valueInputOption']).toBe('USER_ENTERED');
  });

  it('formula row references match the startRow and rowCount from scout', async () => {
    const plan = makeCrossSheetPlan();

    const capturedValues: string[][] = [];

    const mockHandler = vi.fn(async (tool: string, action: string, params: Record<string, unknown>) => {
      if (tool === 'sheets_analyze' && action === 'scout') {
        // 4 data rows starting at row 1 (header), so rowCount = 4
        return { sheets: [{ name: 'Orders', rowCount: 4 }] };
      }
      if (tool === 'sheets_data' && action === 'write') {
        const v = params['values'] as string[][];
        capturedValues.push(...v);
        return { success: true };
      }
      return { success: true };
    }) satisfies ExecuteHandlerFn;

    await executePlan(plan.planId, false, mockHandler);

    // startRow=2, rowCount=4 → rows 2..4 (startRow to startRow + max(0, rowCount - startRow))
    // max(0, 4 - 2) = 2, so lastRow = 2 + 2 = 4, rows [2, 3, 4]
    expect(capturedValues.length).toBe(3);
    // First formula references row 2
    expect(capturedValues[0]![0]).toContain('B2');
    // Last formula references row 4
    expect(capturedValues[2]![0]).toContain('B4');
  });

  it('falls back to startRow+99 when scout returns no matching sheet', async () => {
    const plan = makeCrossSheetPlan();

    let writtenCount = 0;

    const mockHandler = vi.fn(async (tool: string, action: string, params: Record<string, unknown>) => {
      if (tool === 'sheets_analyze' && action === 'scout') {
        // Returns sheets that do NOT include 'Orders'
        return { sheets: [{ name: 'Customers', rowCount: 10 }] };
      }
      if (tool === 'sheets_data' && action === 'write') {
        writtenCount = (params['values'] as unknown[][]).length;
        return { success: true };
      }
      return { success: true };
    }) satisfies ExecuteHandlerFn;

    const result = await executePlan(plan.planId, false, mockHandler);

    expect(result.status).toBe('completed');
    // startRow=2, lastRow = 2 + 99 = 101, so 100 rows
    expect(writtenCount).toBe(100);
  });

  it('regular tool_call steps still go through executeHandler unchanged', async () => {
    const plan = makePlanExecutable(compilePlan('read data', 1, 'spreadsheet-abc'));
    // plan.steps[0] should be a normal sheets_data.read step

    const mockHandler = vi.fn(async () => ({ success: true, data: [] })) satisfies ExecuteHandlerFn;

    const result = await executePlan(plan.planId, false, mockHandler);

    expect(result.status).toBe('completed');
    // Handler was called with the normal step tool/action
    expect(mockHandler).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    );
    const [tool, action] = mockHandler.mock.calls[0]!;
    // Should NOT be internal inject step
    expect(action).not.toBe('inject_cross_sheet_lookup');
    expect(tool).not.toBe('__internal__');
  });
});

// ---------------------------------------------------------------------------
// New workflow templates
// ---------------------------------------------------------------------------

describe('D1: new workflow templates', () => {
  const EXPECTED_TEMPLATES = [
    'multi-sheet-crm',
    'budget-vs-actuals',
    'project-tracker',
    'inventory-with-lookups',
  ];

  it('all 4 new templates appear in listTemplates()', () => {
    const templates = listTemplates();
    const ids = templates.map((t) => t.name);
    // Check by name field (listTemplates returns name, description, stepCount)
    expect(templates.some((t) => t.name === 'Multi-Sheet CRM')).toBe(true);
    expect(templates.some((t) => t.name === 'Budget vs Actuals')).toBe(true);
    expect(templates.some((t) => t.name === 'Project Tracker')).toBe(true);
    expect(templates.some((t) => t.name === 'Inventory with Lookups')).toBe(true);
    void ids; // suppress unused variable lint
  });

  it('multi-sheet-crm has at least 8 steps (3 add_sheet + 3 write + 2 lookup)', () => {
    const templates = listTemplates();
    const crm = templates.find((t) => t.name === 'Multi-Sheet CRM');
    expect(crm).toBeDefined();
    expect(crm!.stepCount).toBeGreaterThanOrEqual(8);
  });

  it('budget-vs-actuals has at least 7 steps', () => {
    const templates = listTemplates();
    const bva = templates.find((t) => t.name === 'Budget vs Actuals');
    expect(bva).toBeDefined();
    expect(bva!.stepCount).toBeGreaterThanOrEqual(7);
  });

  it('project-tracker has at least 5 steps', () => {
    const templates = listTemplates();
    const pt = templates.find((t) => t.name === 'Project Tracker');
    expect(pt).toBeDefined();
    expect(pt!.stepCount).toBeGreaterThanOrEqual(5);
  });

  it('inventory-with-lookups has at least 7 steps', () => {
    const templates = listTemplates();
    const inv = templates.find((t) => t.name === 'Inventory with Lookups');
    expect(inv).toBeDefined();
    expect(inv!.stepCount).toBeGreaterThanOrEqual(7);
  });

  void EXPECTED_TEMPLATES; // suppress unused variable lint
});
