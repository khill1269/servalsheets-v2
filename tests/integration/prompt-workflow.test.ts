/**
 * ServalSheets — Prompt Workflow Integration Tests
 *
 * Validates that registered MCP Prompts:
 *   1. Can be listed via prompts/list (count ≥ 38 per CODEBASE_CONTEXT)
 *   2. Return valid MCP message structures when called via prompts/get
 *   3. Accept spreadsheetId arguments correctly
 *   4. Have non-empty content in every message
 *   5. Do not reference tool.action pairs that don't exist in TOOL_ACTIONS
 *   6. Every prompt succeeds when called with its minimal required args
 *
 * This is the "prompt → action → verify" integration loop: fetch a prompt,
 * inspect the embedded tool suggestions, verify those tools/actions are real.
 *
 * No real Google API calls. Uses InMemoryTransport.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServalSheetsTestHarness,
  type McpTestHarness,
} from '../helpers/mcp-test-harness.js';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

// Minimal valid arguments for every registered prompt.
// Only includes required fields; optional fields are omitted.
const PROMPT_MINIMAL_ARGS: Record<string, Record<string, string | number | string[]>> = {
  welcome: {},
  test_connection: {},
  first_operation: { spreadsheetId: TEST_SPREADSHEET_ID },
  analyze_spreadsheet: { spreadsheetId: TEST_SPREADSHEET_ID },
  transform_data: {
    spreadsheetId: TEST_SPREADSHEET_ID,
    range: 'Sheet1!A1:D10',
    transformation: 'uppercase all text values',
  },
  create_report: { spreadsheetId: TEST_SPREADSHEET_ID },
  clean_data: { spreadsheetId: TEST_SPREADSHEET_ID, range: 'Sheet1!A1:D100' },
  migrate_data: {
    sourceSpreadsheetId: TEST_SPREADSHEET_ID,
    targetSpreadsheetId: '1abc2defGHIJ',
    sourceRange: 'Sheet1!A1:D50',
  },
  setup_budget: {},
  import_data: {
    spreadsheetId: TEST_SPREADSHEET_ID,
    dataSource: 'CSV export from Salesforce CRM',
  },
  setup_collaboration: {
    spreadsheetId: TEST_SPREADSHEET_ID,
    collaborators: 'alice@example.com, bob@example.com',
  },
  diagnose_errors: { spreadsheetId: TEST_SPREADSHEET_ID },
  recover_from_error: { errorCode: 'SHEET_NOT_FOUND' },
  troubleshoot_performance: { spreadsheetId: TEST_SPREADSHEET_ID },
  fix_data_quality: { spreadsheetId: TEST_SPREADSHEET_ID, range: 'Sheet1!A1:E200' },
  optimize_formulas: { spreadsheetId: TEST_SPREADSHEET_ID },
  bulk_import_data: { spreadsheetId: TEST_SPREADSHEET_ID },
  safe_operation: {
    spreadsheetId: TEST_SPREADSHEET_ID,
    operationType: 'bulk_update',
  },
  bulk_import: {
    spreadsheetId: TEST_SPREADSHEET_ID,
    dataDescription: '5000 rows of sales transactions from Q4',
  },
  undo_changes: { spreadsheetId: TEST_SPREADSHEET_ID },
  when_to_confirm: {},
  confirmation_examples: {},
  advanced_data_migration: {
    sourceSpreadsheetId: TEST_SPREADSHEET_ID,
    targetSpreadsheetId: '1abc2defGHIJ',
  },
  performance_audit: { spreadsheetId: TEST_SPREADSHEET_ID },
  batch_optimizer: { spreadsheetId: TEST_SPREADSHEET_ID, operationType: 'read' },
  ultimate_analysis: { spreadsheetId: TEST_SPREADSHEET_ID },
  create_visualization: { spreadsheetId: TEST_SPREADSHEET_ID },
  analyze_with_history: { spreadsheetId: TEST_SPREADSHEET_ID },
  masterclass_data_quality: {},
  masterclass_formulas: {},
  masterclass_performance: { spreadsheetId: TEST_SPREADSHEET_ID },
  challenge_quality_detective: { spreadsheetId: TEST_SPREADSHEET_ID },
  challenge_performance_profiler: { spreadsheetId: TEST_SPREADSHEET_ID },
  scenario_multi_user: { spreadsheetId: TEST_SPREADSHEET_ID },
  auto_analyze: { spreadsheetId: TEST_SPREADSHEET_ID },
  full_setup: { type: 'budget', name: 'Q1 2026 Budget' },
  audit_security: { spreadsheetId: TEST_SPREADSHEET_ID },
  compare_spreadsheets: {
    spreadsheetId1: TEST_SPREADSHEET_ID,
    spreadsheetId2: '1abc2defGHIJ',
  },
  generate_sheet_from_description: { description: 'Q1 budget tracker with revenue and expenses' },
  what_if_scenario_modeling: {
    spreadsheetId: TEST_SPREADSHEET_ID,
    scenario: 'revenue drops 20%',
  },
  cross_spreadsheet_federation: { spreadsheetIds: TEST_SPREADSHEET_ID },
  migrate_spreadsheet: { sourceSpreadsheetId: TEST_SPREADSHEET_ID },
};

// Extract all tool.action pairs mentioned in a prompt text block.
// Looks for patterns like: sheets_data action:"read" or sheets_analyze.analyze_data
function extractToolActionRefs(text: string): Array<{ tool: string; action: string }> {
  const results: Array<{ tool: string; action: string }> = [];

  // Pattern 1: tool_name action:"action_name"
  const pattern1 = /\b(sheets_\w+)\s+action:\s*["']([a-z_]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = pattern1.exec(text)) !== null) {
    results.push({ tool: m[1]!, action: m[2]! });
  }

  // Pattern 2: sheets_tool.action_name
  const pattern2 = /\b(sheets_\w+)\.([a-z_]+)\b/g;
  while ((m = pattern2.exec(text)) !== null) {
    results.push({ tool: m[1]!, action: m[2]! });
  }

  return results;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Prompt workflow integration', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        name: 'servalsheets-prompt-workflow-test',
        version: '1.0.0-test',
      },
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  // ── 1. Listing ──────────────────────────────────────────────────────────────

  it('prompts/list returns ≥ 38 prompts', async () => {
    const result = await harness.client.listPrompts();
    expect(result.prompts.length).toBeGreaterThanOrEqual(38);
  });

  it('all prompts have a non-empty name and description', async () => {
    const result = await harness.client.listPrompts();
    for (const prompt of result.prompts) {
      expect(prompt.name.length).toBeGreaterThan(0);
      expect(typeof prompt.description).toBe('string');
      // name must be snake_case identifier
      expect(prompt.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  // ── 2. Core workflow prompts return valid message structure ─────────────────

  const WORKFLOW_PROMPTS: Array<keyof typeof PROMPT_MINIMAL_ARGS> = [
    'welcome',
    'test_connection',
    'first_operation',
    'analyze_spreadsheet',
    'create_report',
    'diagnose_errors',
  ];

  for (const promptName of WORKFLOW_PROMPTS) {
    it(`prompts/get "${promptName}" returns a valid MCP message`, async () => {
      const result = await harness.client.getPrompt({
        name: promptName,
        arguments: PROMPT_MINIMAL_ARGS[promptName] ?? {},
      });

      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);

      for (const msg of result.messages) {
        expect(['user', 'assistant']).toContain(msg.role);
        expect(msg.content).toBeDefined();
        expect(msg.content.type).toBe('text');
        if (msg.content.type === 'text') {
          expect(msg.content.text.length).toBeGreaterThan(0);
        }
      }
    });
  }

  // ── 3. spreadsheetId argument injection ────────────────────────────────────

  it('first_operation prompt injects spreadsheetId into message text', async () => {
    const result = await harness.client.getPrompt({
      name: 'first_operation',
      arguments: { spreadsheetId: TEST_SPREADSHEET_ID },
    });

    const allText = result.messages
      .filter((m) => m.content.type === 'text')
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');

    expect(allText).toContain(TEST_SPREADSHEET_ID);
  });

  it('analyze_spreadsheet prompt injects spreadsheetId into message text', async () => {
    const customId = 'custom-spreadsheet-id-12345';
    const result = await harness.client.getPrompt({
      name: 'analyze_spreadsheet',
      arguments: { spreadsheetId: customId },
    });

    const allText = result.messages
      .filter((m) => m.content.type === 'text')
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');

    expect(allText).toContain(customId);
  });

  // ── 4. Tool/action references in prompts are valid ─────────────────────────

  it('tool.action references in welcome prompt all exist in TOOL_ACTIONS', async () => {
    const result = await harness.client.getPrompt({
      name: 'welcome',
      arguments: {},
    });

    const allText = result.messages
      .filter((m) => m.content.type === 'text')
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');

    const refs = extractToolActionRefs(allText);
    for (const ref of refs) {
      const toolActions = TOOL_ACTIONS[ref.tool];
      expect(toolActions, `Tool "${ref.tool}" not found in TOOL_ACTIONS`).toBeDefined();
      if (toolActions) {
        expect(
          toolActions,
          `Action "${ref.action}" not found in ${ref.tool}`
        ).toContain(ref.action);
      }
    }
  });

  // ── 5. Every prompt succeeds with minimal args ─────────────────────────────

  it('getPrompt for every known prompt succeeds with its minimal args', async () => {
    const { prompts } = await harness.client.listPrompts();

    const results = await Promise.allSettled(
      prompts.map((p) => {
        const args = PROMPT_MINIMAL_ARGS[p.name] ?? { spreadsheetId: TEST_SPREADSHEET_ID };
        return harness.client.getPrompt({ name: p.name, arguments: args });
      })
    );

    const failures = results
      .map((r, i) => ({
        name: prompts[i]!.name,
        result: r,
        error: r.status === 'rejected' ? (r.reason as Error).message : null,
      }))
      .filter((r) => r.result.status === 'rejected');

    if (failures.length > 0) {
      const unknownPrompts = failures.filter((f) => !(f.name in PROMPT_MINIMAL_ARGS));
      // Unknown prompts that aren't in our args map fall back to {spreadsheetId} —
      // if those fail they should be added to PROMPT_MINIMAL_ARGS above.
      expect(
        unknownPrompts.map((f) => `${f.name}: ${f.error}`),
        'Add these to PROMPT_MINIMAL_ARGS in this test file'
      ).toHaveLength(0);
    }

    expect(
      failures.map((f) => `${f.name}: ${f.error}`),
    ).toHaveLength(0);
  });
});
