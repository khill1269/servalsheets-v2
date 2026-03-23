/**
 * Tool Selection & Routing Tests
 *
 * Tests that Claude gets the right signals to select the correct tool.
 * Validates decision tree completeness, annotation consistency,
 * and description routing hints.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_ANNOTATIONS,
  TOOL_DESCRIPTIONS,
  TOOL_DESCRIPTIONS_MINIMAL,
  ACTION_COUNT,
} from '../../src/schemas/index.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/tool-definitions.js';
import { getServerInstructions } from '../../src/mcp/features-2025-11-25.js';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';

const ALL_TOOLS = TOOL_DEFINITIONS.map((t) => t.name);

describe('Tool Routing - Description Quality', () => {
  it('should mention key actions in full descriptions', () => {
    // Each full description should mention its most important actions
    const toolKeyActions: Record<string, string[]> = {
      sheets_auth: ['status', 'login', 'callback'],
      sheets_core: ['get', 'create', 'add_sheet', 'batch_get'],
      sheets_data: ['read', 'write', 'append', 'batch_read', 'batch_write'],
      sheets_format: ['set_format', 'set_background'],
      sheets_dimensions: ['insert', 'delete', 'resize'],
      sheets_visualize: ['chart_create', 'pivot_create'],
      sheets_analyze: ['comprehensive', 'scout'],
      sheets_fix: ['fix'],
      sheets_composite: ['import_csv', 'smart_append'],
      sheets_session: ['set_active', 'get_context'],
    };

    for (const [tool, actions] of Object.entries(toolKeyActions)) {
      const desc = TOOL_DESCRIPTIONS[tool]!;
      for (const action of actions) {
        expect(desc).toContain(action);
      }
    }
  });

  it('should have minimal descriptions that are routing-sufficient', () => {
    // Each minimal description should contain enough to route correctly
    for (const tool of ALL_TOOLS) {
      const desc = TOOL_DESCRIPTIONS_MINIMAL[tool]!;
      expect(desc.length).toBeGreaterThan(10);
      // Should mention the tool category or key purpose
      expect(desc.length).toBeLessThanOrEqual(300); // Token efficient
    }
  });

  it('should not have duplicate tool descriptions', () => {
    const seen = new Set<string>();
    for (const tool of ALL_TOOLS) {
      const desc = TOOL_DESCRIPTIONS[tool]!;
      // Descriptions shouldn't be identical (that would mean wrong routing)
      expect(seen.has(desc)).toBe(false);
      seen.add(desc);
    }
  });

  it('should not present sheets_analyze as a blanket universal entry point', () => {
    const fullDesc = TOOL_DESCRIPTIONS['sheets_analyze']!;
    const minimalDesc = TOOL_DESCRIPTIONS_MINIMAL['sheets_analyze']!;

    expect(fullDesc).not.toContain('ALWAYS START HERE');
    expect(fullDesc).toContain('Skip this tool when:');
    expect(fullDesc).toContain('Use this first ONLY when:');
    expect(minimalDesc).not.toContain('START HERE');
    expect(minimalDesc).toContain('skip this tool');
  });
});

describe('Tool Routing - Annotation Consistency', () => {
  it('read-only tools should also be non-destructive', () => {
    for (const [_tool, ann] of Object.entries(TOOL_ANNOTATIONS)) {
      if (ann.readOnlyHint) {
        expect(ann.destructiveHint).toBe(false);
      }
    }
  });

  it('destructive tools should not be read-only', () => {
    for (const [_tool, ann] of Object.entries(TOOL_ANNOTATIONS)) {
      if (ann.destructiveHint) {
        expect(ann.readOnlyHint).toBe(false);
      }
    }
  });

  it('local-only tools should not have external API calls', () => {
    // If openWorldHint is false, the tool shouldn't call Google APIs
    const localTools = Object.entries(TOOL_ANNOTATIONS)
      .filter(([_, ann]) => !ann.openWorldHint)
      .map(([name]) => name);

    // sheets_quality and sheets_history call Google API (resolve_conflict, undo/redo)
    // sheets_dependencies calls Google API (model_scenario fetches live values, post-P13)
    // so they are NOT local-only
    expect(localTools).toContain('sheets_session');
    expect(localTools).toContain('sheets_confirm');
  });
});

describe('Tool Routing - Completions', () => {
  it('should have action completions for all 22 tools', () => {
    for (const tool of ALL_TOOLS) {
      expect(TOOL_ACTIONS[tool]).toBeDefined();
      expect(TOOL_ACTIONS[tool]!.length).toBeGreaterThan(0);
    }
  });

  it('total actions should match ACTION_COUNT', () => {
    let totalActions = 0;
    for (const actions of Object.values(TOOL_ACTIONS)) {
      totalActions += actions.length;
    }
    expect(totalActions).toBe(ACTION_COUNT);
  });

  it('should have unique action names within each tool', () => {
    for (const [_tool, actions] of Object.entries(TOOL_ACTIONS)) {
      const unique = new Set(actions);
      expect(unique.size).toBe(actions.length);
    }
  });
});

describe('Tool Routing - Decision Tree Coverage', () => {
  const instructions = getServerInstructions();

  it('should cover CRUD scenarios', () => {
    // Create
    expect(instructions).toContain('sheets_core');
    expect(instructions).toContain('create');

    // Read
    expect(instructions).toContain('sheets_data');
    expect(instructions).toContain('read');

    // Update
    expect(instructions).toContain('write');

    // Delete
    expect(instructions).toContain('delete_sheet');
  });

  it('should cover data quality workflow', () => {
    expect(instructions).toContain('sheets_analyze');
    expect(instructions).toContain('sheets_fix');
    expect(instructions).toContain('sheets_quality');
  });

  it('should cover enterprise scenarios', () => {
    expect(instructions).toContain('sheets_bigquery');
    expect(instructions).toContain('sheets_appsscript');
    expect(instructions).toContain('sheets_templates');
  });

  it('should cover collaboration scenarios', () => {
    expect(instructions).toContain('sheets_collaborate');
    expect(instructions).toContain('share_add');
    expect(instructions).toContain('comment_add');
  });

  it('should cover automation scenarios', () => {
    expect(instructions).toContain('sheets_webhook');
    expect(instructions).toContain('sheets_appsscript');
    expect(instructions).toContain('trigger');
  });

  it('should cover safety scenarios', () => {
    expect(instructions).toContain('sheets_confirm');
    expect(instructions).toContain('sheets_transaction');
    expect(instructions).toContain('dryRun');
  });

  it('should cover large dataset scenarios', () => {
    expect(instructions).toContain('>10K rows');
    expect(instructions).toContain('batch_read');
    expect(instructions).toContain('sheets_bigquery');
  });

  it('should cover dependency checking before destructive ops', () => {
    expect(instructions).toContain('sheets_dependencies');
    expect(instructions).toContain('analyze_impact');
  });
});

describe('Tool Routing - Cross-Tool Conflicts', () => {
  it('should not have overlapping tool purposes in descriptions', () => {
    // sheets_data vs sheets_composite: both handle writes but differently
    const dataDesc = TOOL_DESCRIPTIONS['sheets_data']!.toLowerCase();
    const compositeDesc = TOOL_DESCRIPTIONS['sheets_composite']!.toLowerCase();

    // sheets_composite should mention "import" or "deduplicate" to differentiate
    expect(compositeDesc).toMatch(/import|deduplicate|smart.append|bulk/);

    // sheets_data should focus on cell-level operations
    expect(dataDesc).toMatch(/read|write|append|cell|value/);
  });

  it('should differentiate quality vs analyze', () => {
    const qualityDesc = TOOL_DESCRIPTIONS['sheets_quality']!.toLowerCase();
    const analyzeDesc = TOOL_DESCRIPTIONS['sheets_analyze']!.toLowerCase();

    // Quality = validation/conflicts
    expect(qualityDesc).toMatch(/validat|conflict|quality/);

    // Analyze = comprehensive analysis/patterns
    expect(analyzeDesc).toMatch(/analy|pattern|comprehensive|scout/);
  });

  it('should differentiate transaction vs composite', () => {
    const transDesc = TOOL_DESCRIPTIONS['sheets_transaction']!.toLowerCase();
    const compositeDesc = TOOL_DESCRIPTIONS['sheets_composite']!.toLowerCase();

    // Transaction = atomic operations
    expect(transDesc).toMatch(/atomic|begin|commit|queue/);

    // Composite = high-level operations
    expect(compositeDesc).toMatch(/import|csv|smart|deduplicate/);
  });
});
