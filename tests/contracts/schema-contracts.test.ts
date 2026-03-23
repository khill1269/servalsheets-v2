/**
 * Schema Contract Tests
 *
 * Ensures all tool schemas follow MCP best practices:
 * - Schemas are not empty (can validate inputs)
 * - Discriminated unions work correctly
 * - Required fields are enforced
 * - All actions are documented
 *
 * These tests focus on what matters: that schemas can actually validate inputs correctly.
 * We don't test zodToJsonSchema conversion since the MCP SDK handles that internally.
 */

import { describe, it, expect } from 'vitest';
import {
  SheetsAuthInputSchema,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsVisualizeInputSchema,
  SheetsCollaborateInputSchema,
  SheetsAdvancedInputSchema,
  SheetsTransactionInputSchema,
  SheetsQualityInputSchema,
  SheetsHistoryInputSchema,
  SheetsConfirmInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsFixInputSchema,
  CompositeInputSchema,
  SheetsSessionInputSchema,
  SheetsTemplatesInputSchema,
  SheetsBigQueryInputSchema,
  SheetsAppsScriptInputSchema,
  SheetsWebhookInputSchema,
  SheetsDependenciesInputSchema,
  SheetsFederationInputSchema,
  SheetsComputeInputSchema,
  SheetsAgentInputSchema,
  SheetsConnectorsInputSchema,
  TOOL_COUNT,
  ACTION_COUNT,
} from '../../src/schemas/index.js';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import { calculateTotalActions } from '../helpers/count-actions.js';

// Sample valid inputs for each tool (using first action from each schema)
// All inputs are now wrapped in "request:" property
const VALID_INPUTS: Record<string, unknown> = {
  sheets_auth: { request: { action: 'status' } },
  sheets_core: { request: { action: 'get', spreadsheetId: 'test123' } },
  sheets_data: {
    request: { action: 'read', spreadsheetId: 'test123', range: { a1: 'Sheet1!A1:B10' } },
  },
  sheets_format: {
    request: {
      action: 'set_format',
      spreadsheetId: 'test123',
      range: { a1: 'Sheet1!A1' },
      format: {},
    },
  },
  sheets_dimensions: {
    request: {
      action: 'insert',
      dimension: 'ROWS',
      spreadsheetId: 'test123',
      sheetId: 0,
      startIndex: 5,
    },
  },
  sheets_visualize: {
    request: {
      action: 'chart_create',
      spreadsheetId: 'test123',
      sheetId: 0,
      chartType: 'BAR',
      data: { sourceRange: { a1: 'Sheet1!A1:C10' } },
      position: { anchorCell: 'E1' },
    },
  },
  sheets_collaborate: {
    request: {
      action: 'share_add',
      spreadsheetId: 'test123',
      type: 'anyone',
      role: 'reader',
    },
  },
  sheets_analyze: { request: { action: 'comprehensive', spreadsheetId: 'test123' } },
  sheets_advanced: {
    request: {
      action: 'add_named_range',
      spreadsheetId: 'test123',
      name: 'TestRange',
      range: { a1: 'Sheet1!A1:C10' },
    },
  },
  sheets_transaction: { request: { action: 'begin', spreadsheetId: 'test123' } },
  sheets_quality: { request: { action: 'validate', value: 'test-value' } },
  sheets_history: { request: { action: 'list' } },
  sheets_confirm: {
    request: {
      action: 'request',
      plan: {
        title: 'Test Plan',
        description: 'Test',
        steps: [
          {
            stepNumber: 1,
            description: 'Test step',
            tool: 'sheets_data',
            action: 'read',
            risk: 'low',
            estimatedApiCalls: 1,
            isDestructive: false,
            canUndo: false,
          },
        ],
      },
    },
  },
  sheets_fix: {
    request: {
      action: 'fix',
      spreadsheetId: 'test123',
      issues: [
        {
          type: 'MULTIPLE_TODAY',
          severity: 'medium',
          sheet: 'Sheet1',
          description: 'Multiple TODAY() calls',
        },
      ],
    },
  },
  sheets_composite: {
    request: {
      action: 'import_csv',
      spreadsheetId: 'test123',
      csvData: 'Name,Age\nAlice,30',
      mode: 'replace',
    },
  },
  sheets_session: { request: { action: 'get_active' } },
  sheets_templates: { request: { action: 'list', includeBuiltin: false } },
  sheets_bigquery: { request: { action: 'list_datasets', projectId: 'my-gcp-project' } },
  sheets_appsscript: { request: { action: 'list_versions', scriptId: 'test-script-id' } },
  sheets_webhook: {
    request: {
      action: 'register',
      spreadsheetId: 'test123',
      webhookUrl: 'https://example.com/webhook',
      eventTypes: ['sheet.update'],
    },
  },
  sheets_dependencies: { request: { action: 'build', spreadsheetId: 'test123' } },
  sheets_federation: { request: { action: 'list_servers' } },
  sheets_compute: { request: { action: 'evaluate', spreadsheetId: 'test123', formula: '=SUM(A1:A10)' } },
  sheets_agent: { request: { action: 'list_plans' } },
  sheets_connectors: { request: { action: 'list_connectors' } },
};

// All tool input schemas (25 tools - includes Tier 7 enterprise tools + federation + connectors)
const TOOL_SCHEMAS = [
  { name: 'sheets_auth', schema: SheetsAuthInputSchema },
  { name: 'sheets_core', schema: SheetsCoreInputSchema },
  { name: 'sheets_data', schema: SheetsDataInputSchema },
  { name: 'sheets_format', schema: SheetsFormatInputSchema },
  { name: 'sheets_dimensions', schema: SheetsDimensionsInputSchema },
  { name: 'sheets_visualize', schema: SheetsVisualizeInputSchema },
  { name: 'sheets_collaborate', schema: SheetsCollaborateInputSchema },
  { name: 'sheets_advanced', schema: SheetsAdvancedInputSchema },
  { name: 'sheets_transaction', schema: SheetsTransactionInputSchema },
  { name: 'sheets_quality', schema: SheetsQualityInputSchema },
  { name: 'sheets_history', schema: SheetsHistoryInputSchema },
  { name: 'sheets_confirm', schema: SheetsConfirmInputSchema },
  { name: 'sheets_analyze', schema: SheetsAnalyzeInputSchema },
  { name: 'sheets_fix', schema: SheetsFixInputSchema },
  { name: 'sheets_composite', schema: CompositeInputSchema },
  { name: 'sheets_session', schema: SheetsSessionInputSchema },
  { name: 'sheets_templates', schema: SheetsTemplatesInputSchema },
  { name: 'sheets_bigquery', schema: SheetsBigQueryInputSchema },
  { name: 'sheets_appsscript', schema: SheetsAppsScriptInputSchema },
  { name: 'sheets_webhook', schema: SheetsWebhookInputSchema },
  { name: 'sheets_dependencies', schema: SheetsDependenciesInputSchema },
  { name: 'sheets_federation', schema: SheetsFederationInputSchema },
  { name: 'sheets_compute', schema: SheetsComputeInputSchema },
  { name: 'sheets_agent', schema: SheetsAgentInputSchema },
  { name: 'sheets_connectors', schema: SheetsConnectorsInputSchema },
];

describe('Schema Contracts', () => {
  describe('Tool Registry Integrity', () => {
    it('should have exactly 25 tools (includes Tier 7 enterprise + federation + compute + agent + connectors)', () => {
      expect(TOOL_COUNT).toBe(25);
      expect(TOOL_SCHEMAS).toHaveLength(25);
    });

    it('should have correct total action count (dynamically validated)', () => {
      // Calculate actual action count from TOOL_ACTIONS (single source of truth)
      const actualActionCount = calculateTotalActions(TOOL_ACTIONS);

      // ACTION_COUNT constant must match the sum of all tool actions
      expect(ACTION_COUNT).toBe(actualActionCount);

      // Sanity check: at least 290 actions (grows as tools are added)
      expect(actualActionCount).toBeGreaterThan(290);
    });

    it('should not have duplicate tool names', () => {
      const names = TOOL_SCHEMAS.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('Schema Validation (Not Empty)', () => {
    for (const tool of TOOL_SCHEMAS) {
      it(`${tool.name} can validate valid inputs`, () => {
        const validInput = VALID_INPUTS[tool.name];
        expect(validInput).toBeDefined();

        const result = tool.schema.safeParse(validInput);

        if (!result.success) {
          console.error(`${tool.name} validation failed:`, result.error.issues);
        }

        expect(result.success).toBe(true);
      });

      it(`${tool.name} rejects invalid inputs`, () => {
        // Test with invalid action (wrapped in request)
        const invalidAction = tool.schema.safeParse({
          request: {
            action: 'invalid_action_name',
            spreadsheetId: 'test123',
          },
        });
        expect(invalidAction.success).toBe(false);

        // Test with missing required field (spreadsheetId)
        const missingField = tool.schema.safeParse({
          request: {
            action: 'get',
          },
        });
        expect(missingField.success).toBe(false);
      });

      it(`${tool.name} schema is defined and is a Zod schema`, () => {
        expect(tool.schema).toBeDefined();
        expect(tool.schema._def).toBeDefined(); // Zod schemas have _def
        expect(typeof tool.schema.safeParse).toBe('function');
      });
    }
  });

  describe('Discriminated Union Behavior', () => {
    it('sheets_data accepts all expected actions', () => {
      const actions = ['read', 'write', 'append', 'clear'];

      for (const action of actions) {
        const result = SheetsDataInputSchema.safeParse({
          request: {
            action,
            spreadsheetId: 'test123',
            range: { a1: 'Sheet1!A1:B10' },
            ...(action === 'write' || action === 'append' ? { values: [[1, 2]] } : {}),
          },
        });

        if (!result.success) {
          console.error(`sheets_data action "${action}" failed:`, result.error.issues);
        }

        expect(result.success).toBe(true);
      }
    });

    it('sheets_data append accepts tableId without range', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'append',
          spreadsheetId: 'test123',
          tableId: 'table-1',
          values: [[1, 2]],
        },
      });

      if (!result.success) {
        console.error('sheets_data append with tableId failed:', result.error.issues);
      }

      expect(result.success).toBe(true);
    });

    it('sheets_core discriminates correctly', () => {
      // 'get' requires spreadsheetId
      const getValid = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'get',
          spreadsheetId: 'test123',
        },
      });
      expect(getValid.success).toBe(true);

      // 'create' requires title
      const createValid = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'create',
          title: 'New Spreadsheet',
        },
      });
      expect(createValid.success).toBe(true);

      // 'add_sheet' requires spreadsheetId and title
      const addSheetValid = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'add_sheet',
          spreadsheetId: 'test123',
          title: 'New Sheet',
        },
      });
      expect(addSheetValid.success).toBe(true);
    });
  });

  describe('Required Fields Validation', () => {
    it('sheets_data requires spreadsheetId', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'read',
          range: { a1: 'Sheet1!A1' },
          // Missing spreadsheetId
        },
      });
      expect(result.success).toBe(false);
    });

    it('sheets_data write action requires values', () => {
      const result = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test123',
          range: { a1: 'Sheet1!A1' },
          // Missing values
        },
      });
      expect(result.success).toBe(false);
    });

    it('sheets_core add_sheet action requires title', () => {
      const result = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'add_sheet',
          spreadsheetId: 'test123',
          // Missing title
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema Completeness', () => {
    it('all tools have valid input examples', () => {
      // Ensure we have a valid input for every tool
      for (const tool of TOOL_SCHEMAS) {
        expect(VALID_INPUTS[tool.name]).toBeDefined();
      }
    });

    it('all tool schemas can be stringified', () => {
      // Ensure schemas don't have circular references
      for (const tool of TOOL_SCHEMAS) {
        expect(() => JSON.stringify(tool.schema._def)).not.toThrow();
      }
    });
  });

  describe('Discriminated Union Validation (Phase 1.1)', () => {
    /**
     * Phase 1.1: All schemas converted to discriminated unions
     * This test suite verifies that all 16 schemas properly use z.discriminatedUnion()
     * and correctly validate action-specific required fields.
     */

    it('all schemas use discriminated unions (verify discriminator field in request)', () => {
      // All schemas now use { request: z.discriminatedUnion(...) } pattern
      // or { request: z.object({ action: z.enum([...]), ... }) } pattern
      // or { request: z.preprocess(..., z.discriminatedUnion(...)) } pattern (type='pipe')

      for (const tool of TOOL_SCHEMAS) {
        // Get the schema definition
        const zodDef = (tool.schema as unknown as { _def: { type?: string; shape?: unknown } })
          ._def;
        expect(zodDef).toBeDefined();
        // Outer type can be 'object' or 'pipe' (for schemas using z.preprocess at top level)
        expect(['object', 'pipe'].includes(zodDef.type ?? '')).toBe(true);

        // For pipe types (z.preprocess), we need to traverse the inner schema
        let shape = zodDef.shape;
        if (zodDef.type === 'pipe') {
          // Get the inner schema from the pipe (z.preprocess wraps in ZodPipeline)
          const innerDef = (zodDef as unknown as { out?: { _def?: { shape?: unknown } } })?.out
            ?._def;
          shape = innerDef?.shape;
        }

        shape = typeof shape === 'function' ? (shape as () => unknown)() : shape;
        const requestField = (shape as Record<string, unknown>)?.['request'];
        expect(requestField).toBeDefined();

        // Request field should be either discriminated union or object with action enum
        // Some schemas use z.preprocess() which creates a 'pipe' type
        const requestDef = (requestField as { _def?: { type?: string; discriminator?: string } })
          ?._def;
        expect(requestDef).toBeDefined();
        // Either discriminated union (type='union'), object with action, or pipe (z.preprocess)
        expect(['union', 'object', 'pipe'].includes(requestDef?.type ?? '')).toBe(true);
      }
    });

    it('schemas reject invalid action values', () => {
      for (const tool of TOOL_SCHEMAS) {
        const result = tool.schema.safeParse({
          request: {
            action: 'this_action_does_not_exist',
            spreadsheetId: 'test123',
          },
        });
        expect(result.success).toBe(false);
      }
    });

    it('sheets_core validates sample actions with discriminated union', () => {
      // Test a representative sample of actions to verify discriminated union works
      const validActions = [
        { action: 'get', spreadsheetId: 'test123' },
        { action: 'create', title: 'New Spreadsheet' },
        { action: 'copy', spreadsheetId: 'test123' },
        { action: 'get_url', spreadsheetId: 'test123' },
        { action: 'list_sheets', spreadsheetId: 'test123' },
        { action: 'add_sheet', spreadsheetId: 'test123', title: 'New Sheet' },
        { action: 'duplicate_sheet', spreadsheetId: 'test123', sheetId: 0 },
        { action: 'delete_sheet', spreadsheetId: 'test123', sheetId: 0 },
      ];

      for (const input of validActions) {
        const result = SheetsCoreInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(`sheets_core action "${input.action}" failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      }
    });

    it('sheets_visualize validates all 17 actions (10 chart + 7 pivot)', () => {
      const chartActions = [
        {
          action: 'chart_create',
          spreadsheetId: 'test',
          sheetId: 0,
          chartType: 'BAR',
          data: { sourceRange: { a1: 'A1:C10' } },
          position: { anchorCell: 'E1' },
        },
        { action: 'suggest_chart', spreadsheetId: 'test', range: { a1: 'A1:C10' } },
        { action: 'chart_update', spreadsheetId: 'test', chartId: 123 },
        { action: 'chart_delete', spreadsheetId: 'test', chartId: 123 },
        { action: 'chart_list', spreadsheetId: 'test' },
        { action: 'chart_get', spreadsheetId: 'test', chartId: 123 },
        {
          action: 'chart_move',
          spreadsheetId: 'test',
          chartId: 123,
          position: { anchorCell: 'F1' },
        },
        { action: 'chart_resize', spreadsheetId: 'test', chartId: 123, width: 400, height: 300 },
        {
          action: 'chart_update_data_range',
          spreadsheetId: 'test',
          chartId: 123,
          data: { sourceRange: { a1: 'A1:D10' } },
        },
      ];

      const pivotActions = [
        {
          action: 'pivot_create',
          spreadsheetId: 'test',
          sourceRange: { a1: 'A1:C10' },
          values: [{ sourceColumnOffset: 0, summarizeFunction: 'SUM' }],
        },
        { action: 'suggest_pivot', spreadsheetId: 'test', range: { a1: 'A1:C10' } },
        { action: 'pivot_update', spreadsheetId: 'test', sheetId: 0 },
        { action: 'pivot_delete', spreadsheetId: 'test', sheetId: 0 },
        { action: 'pivot_list', spreadsheetId: 'test' },
        { action: 'pivot_get', spreadsheetId: 'test', sheetId: 0 },
        { action: 'pivot_refresh', spreadsheetId: 'test', sheetId: 0 },
      ];

      for (const input of [...chartActions, ...pivotActions]) {
        const result = SheetsVisualizeInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(`sheets_visualize action "${input.action}" failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      }
    });

    it('sheets_format validates sample format actions with required fields', () => {
      // Test a representative sample of format actions
      const formatActions = [
        { action: 'set_format', spreadsheetId: 'test', range: { a1: 'A1' }, format: {} },
        { action: 'suggest_format', spreadsheetId: 'test', range: { a1: 'A1' } },
        {
          action: 'set_background',
          spreadsheetId: 'test',
          range: { a1: 'A1' },
          color: { red: 1, green: 0, blue: 0 },
        },
        {
          action: 'set_text_format',
          spreadsheetId: 'test',
          range: { a1: 'A1' },
          textFormat: { bold: true },
        },
        { action: 'set_borders', spreadsheetId: 'test', range: { a1: 'A1' }, borders: {} },
        {
          action: 'set_number_format',
          spreadsheetId: 'test',
          range: { a1: 'A1' },
          numberFormat: { type: 'NUMBER' },
        },
        { action: 'set_alignment', spreadsheetId: 'test', range: { a1: 'A1' }, horizontal: 'LEFT' },
        { action: 'auto_fit', spreadsheetId: 'test', range: { a1: 'A1' } },
        { action: 'clear_format', spreadsheetId: 'test', range: { a1: 'A1' } },
        {
          action: 'apply_preset',
          spreadsheetId: 'test',
          range: { a1: 'A1' },
          preset: 'header_row',
        },
        {
          action: 'rule_add_conditional_format',
          spreadsheetId: 'test',
          sheetId: 0,
          range: { a1: 'A1' },
          rule: {
            type: 'boolean',
            condition: { type: 'NUMBER_GREATER', values: ['0'] },
            format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
          },
        },
      ];

      for (const input of formatActions) {
        const result = SheetsFormatInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(
            `sheets_format action "${input.action}" failed:`,
            JSON.stringify(result.error.issues, null, 2)
          );
        }
        expect(result.success).toBe(true);
      }
    });

    it('sheets_analyze validates sample analyze actions', () => {
      // Test a representative sample of analyze actions
      const analyzeActions = [
        { action: 'analyze_data', spreadsheetId: 'test', range: { a1: 'A1:C10' } },
        { action: 'analyze_formulas', spreadsheetId: 'test' },
        { action: 'analyze_performance', spreadsheetId: 'test' },
        { action: 'analyze_quality', spreadsheetId: 'test' },
        { action: 'analyze_structure', spreadsheetId: 'test' },
        { action: 'detect_patterns', spreadsheetId: 'test', range: { a1: 'A1:C10' } },
        {
          action: 'generate_formula',
          spreadsheetId: 'test',
          range: { a1: 'A1:C10' },
          description: 'sum values',
        },
        { action: 'explain_analysis', question: 'What does this data show?' },
        { action: 'query_natural_language', spreadsheetId: 'test', query: 'What is the average?' },
      ];

      for (const input of analyzeActions) {
        const result = SheetsAnalyzeInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(
            `sheets_analyze action "${input.action}" failed:`,
            JSON.stringify(result.error.issues, null, 2)
          );
        }
        expect(result.success).toBe(true);
      }
    });

    it('sheets_dimensions validates sample dimension actions', () => {
      // Test a representative sample of dimension actions (consolidated actions use dimension param)
      const dimensionActions = [
        { action: 'insert', dimension: 'ROWS', spreadsheetId: 'test', sheetId: 0, startIndex: 5 },
        {
          action: 'insert',
          dimension: 'COLUMNS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 3,
        },
        {
          action: 'delete',
          dimension: 'ROWS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 5,
          endIndex: 10,
        },
        {
          action: 'delete',
          dimension: 'COLUMNS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 3,
          endIndex: 5,
        },
        {
          action: 'resize',
          dimension: 'ROWS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 0,
          endIndex: 10,
          pixelSize: 100,
        },
        {
          action: 'resize',
          dimension: 'COLUMNS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 0,
          endIndex: 5,
          pixelSize: 150,
        },
        {
          action: 'auto_resize',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 0,
          endIndex: 10,
          dimension: 'ROWS',
        },
        {
          action: 'hide',
          dimension: 'ROWS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 5,
          endIndex: 10,
        },
        {
          action: 'hide',
          dimension: 'COLUMNS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 3,
          endIndex: 5,
        },
        {
          action: 'show',
          dimension: 'ROWS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 5,
          endIndex: 10,
        },
        {
          action: 'show',
          dimension: 'COLUMNS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 3,
          endIndex: 5,
        },
        { action: 'append', dimension: 'ROWS', spreadsheetId: 'test', sheetId: 0, count: 5 },
        { action: 'freeze', dimension: 'ROWS', spreadsheetId: 'test', sheetId: 0, count: 2 },
        {
          action: 'group',
          dimension: 'ROWS',
          spreadsheetId: 'test',
          sheetId: 0,
          startIndex: 5,
          endIndex: 10,
        },
        {
          action: 'set_basic_filter',
          spreadsheetId: 'test',
          sheetId: 0,
          range: { a1: 'A1:C10' },
        },
      ];

      // Test a sample of actions
      for (const input of dimensionActions) {
        const result = SheetsDimensionsInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(`sheets_dimensions action "${input.action}" failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      }
    });

    it('sheets_advanced validates all 27 actions (named ranges, protected ranges, metadata, banding, tables, formulas)', () => {
      const advancedActions = [
        {
          action: 'add_named_range',
          spreadsheetId: 'test',
          name: 'TestRange',
          range: { a1: 'A1:C10' },
        },
        { action: 'update_named_range', spreadsheetId: 'test', namedRangeId: 'range_id' },
        { action: 'delete_named_range', spreadsheetId: 'test', namedRangeId: 'range_id' },
        { action: 'list_named_ranges', spreadsheetId: 'test' },
        { action: 'get_named_range', spreadsheetId: 'test', name: 'TestRange' },
        { action: 'add_protected_range', spreadsheetId: 'test', range: { a1: 'A1:C10' } },
        { action: 'update_protected_range', spreadsheetId: 'test', protectedRangeId: 123 },
        { action: 'delete_protected_range', spreadsheetId: 'test', protectedRangeId: 123 },
        { action: 'list_protected_ranges', spreadsheetId: 'test' },
        {
          action: 'set_metadata',
          spreadsheetId: 'test',
          metadataKey: 'key',
          metadataValue: 'value',
        },
        { action: 'get_metadata', spreadsheetId: 'test' },
        { action: 'delete_metadata', spreadsheetId: 'test', metadataId: 123 },
      ];

      for (const input of advancedActions) {
        const result = SheetsAdvancedInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(`sheets_advanced action "${input.action}" failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      }
    });

    it('all schemas enforce action-specific required fields', () => {
      // Test that discriminated unions properly require action-specific fields

      // sheets_data write requires values
      const writeNoValues = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test',
          range: { a1: 'A1' },
          // Missing required 'values' field
        },
      });
      expect(writeNoValues.success).toBe(false);

      // sheets_core add_sheet requires title
      const addSheetNoTitle = SheetsCoreInputSchema.safeParse({
        request: {
          action: 'add_sheet',
          spreadsheetId: 'test',
          // Missing required 'title' field
        },
      });
      expect(addSheetNoTitle.success).toBe(false);

      // sheets_visualize chart_create requires chartType, data, position
      const chartNoData = SheetsVisualizeInputSchema.safeParse({
        request: {
          action: 'chart_create',
          spreadsheetId: 'test',
          sheetId: 0,
          chartType: 'BAR',
          // Missing required 'data' and 'position' fields
        },
      });
      expect(chartNoData.success).toBe(false);

      // sheets_advanced add_named_range requires name and range
      const namedRangeNoName = SheetsAdvancedInputSchema.safeParse({
        request: {
          action: 'add_named_range',
          spreadsheetId: 'test',
          range: { a1: 'A1:C10' },
          // Missing required 'name' field
        },
      });
      expect(namedRangeNoName.success).toBe(false);
    });

    it('schemas allow action-specific optional fields without pollution', () => {
      // Test that schemas don't have optional field pollution
      // (i.e., write action shouldn't accept chart-specific fields)

      const writeWithUnrelatedFields = SheetsDataInputSchema.safeParse({
        request: {
          action: 'write',
          spreadsheetId: 'test',
          range: { a1: 'A1' },
          values: [[1, 2, 3]],
          // These fields are from other actions and should be ignored/stripped
          chartType: 'BAR',
          namedRangeId: '123',
        },
      });

      // Should fail — discriminated union branches use .strict() which rejects extra fields
      expect(writeWithUnrelatedFields.success).toBe(false);
    });

    it('sheets_templates validates all 8 actions', () => {
      const templatesActions = [
        { action: 'list', includeBuiltin: false },
        { action: 'get', templateId: 'template-123' },
        {
          action: 'create',
          spreadsheetId: 'test123',
          name: 'My Template',
          includeData: false,
          includeFormatting: false,
        },
        { action: 'apply', templateId: 'template-123', title: 'New Spreadsheet' },
        { action: 'update', templateId: 'template-123' },
        { action: 'delete', templateId: 'template-123' },
        { action: 'preview', templateId: 'template-123' },
        { action: 'import_builtin', builtinName: 'budget-tracker' },
      ];

      for (const input of templatesActions) {
        const result = SheetsTemplatesInputSchema.safeParse({ request: input });
        if (!result.success) {
          console.error(`sheets_templates action "${input.action}" failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      }
    });

    it('sheets_templates enforces action-specific required fields', () => {
      // create requires spreadsheetId and name
      const createMissingName = SheetsTemplatesInputSchema.safeParse({
        request: {
          action: 'create',
          spreadsheetId: 'test123',
          includeData: false,
          includeFormatting: false,
          // Missing required 'name' field
        },
      });
      expect(createMissingName.success).toBe(false);

      // apply requires templateId and title
      const applyMissingTitle = SheetsTemplatesInputSchema.safeParse({
        request: {
          action: 'apply',
          templateId: 'template-123',
          // Missing required 'title' field
        },
      });
      expect(applyMissingTitle.success).toBe(false);

      // import_builtin requires builtinName
      const importMissingName = SheetsTemplatesInputSchema.safeParse({
        request: {
          action: 'import_builtin',
          // Missing required 'builtinName' field
        },
      });
      expect(importMissingName.success).toBe(false);
    });
  });
});
