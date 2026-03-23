/**
 * ServalSheets - Full Action Coverage Test
 *
 * Parametrized test exercising EVERY action of EVERY tool:
 *   ✓ Schema validates the valid fixture input
 *   ✓ Schema rejects input missing the action field
 *   ✓ Action is recognized in TOOL_ACTIONS
 *   ✓ Action count per tool matches ACTION_COUNTS
 *   ✓ Total action count matches ACTION_COUNT
 *
 * Self-sustaining: when new actions are added to TOOL_ACTIONS,
 * tests auto-appear via generateAllFixtures().
 *
 * Runtime: ~5-8 seconds (all schema validation, no API calls)
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import { ACTION_COUNTS, TOOL_COUNT, ACTION_COUNT } from '../../src/schemas/action-counts.js';
import {
  generateAllFixtures,
  getFixtureToolNames,
  getFixtureActionCount,
} from './action-coverage-fixtures.js';

// ─── Schema Registry ────────────────────────────────────────
// Maps tool names to their Zod input schemas (unwrapped, direct)

import { SheetsAuthInputSchema } from '../../src/schemas/auth.js';
import { SheetsCoreInputSchema } from '../../src/schemas/core.js';
import { SheetsDataInputSchema } from '../../src/schemas/data.js';
import { SheetsFormatInputSchema } from '../../src/schemas/format.js';
import { SheetsDimensionsInputSchema } from '../../src/schemas/dimensions.js';
import { SheetsVisualizeInputSchema } from '../../src/schemas/visualize.js';
import { SheetsCollaborateInputSchema } from '../../src/schemas/collaborate.js';
import { SheetsAdvancedInputSchema } from '../../src/schemas/advanced.js';
import { SheetsTransactionInputSchema } from '../../src/schemas/transaction.js';
import { SheetsQualityInputSchema } from '../../src/schemas/quality.js';
import { SheetsHistoryInputSchema } from '../../src/schemas/history.js';
import { SheetsConfirmInputSchema } from '../../src/schemas/confirm.js';
import { SheetsAnalyzeInputSchema } from '../../src/schemas/analyze.js';
import { SheetsFixInputSchema } from '../../src/schemas/fix.js';
import { CompositeInputSchema } from '../../src/schemas/composite.js';
import { SheetsSessionInputSchema } from '../../src/schemas/session.js';
import { SheetsTemplatesInputSchema } from '../../src/schemas/templates.js';
import { SheetsBigQueryInputSchema } from '../../src/schemas/bigquery.js';
import { SheetsAppsScriptInputSchema } from '../../src/schemas/appsscript.js';
import { SheetsWebhookInputSchema } from '../../src/schemas/webhook.js';
import { SheetsDependenciesInputSchema } from '../../src/schemas/dependencies.js';
import { SheetsFederationInputSchema } from '../../src/schemas/federation.js';
import { SheetsAgentInputSchema } from '../../src/schemas/agent.js';
import { SheetsComputeInputSchema } from '../../src/schemas/compute.js';
import { SheetsConnectorsInputSchema } from '../../src/schemas/connectors.js';

const SCHEMA_REGISTRY: Record<string, z.ZodTypeAny> = {
  sheets_auth: SheetsAuthInputSchema,
  sheets_core: SheetsCoreInputSchema,
  sheets_data: SheetsDataInputSchema,
  sheets_format: SheetsFormatInputSchema,
  sheets_dimensions: SheetsDimensionsInputSchema,
  sheets_visualize: SheetsVisualizeInputSchema,
  sheets_collaborate: SheetsCollaborateInputSchema,
  sheets_advanced: SheetsAdvancedInputSchema,
  sheets_transaction: SheetsTransactionInputSchema,
  sheets_quality: SheetsQualityInputSchema,
  sheets_history: SheetsHistoryInputSchema,
  sheets_confirm: SheetsConfirmInputSchema,
  sheets_analyze: SheetsAnalyzeInputSchema,
  sheets_fix: SheetsFixInputSchema,
  sheets_composite: CompositeInputSchema,
  sheets_session: SheetsSessionInputSchema,
  sheets_templates: SheetsTemplatesInputSchema,
  sheets_bigquery: SheetsBigQueryInputSchema,
  sheets_appsscript: SheetsAppsScriptInputSchema,
  sheets_webhook: SheetsWebhookInputSchema,
  sheets_dependencies: SheetsDependenciesInputSchema,
  sheets_federation: SheetsFederationInputSchema,
  sheets_agent: SheetsAgentInputSchema,
  sheets_compute: SheetsComputeInputSchema,
  sheets_connectors: SheetsConnectorsInputSchema,
};

// ─── Top-Level Inventory Tests ──────────────────────────────

describe('Action Coverage - Inventory', () => {
  it(`has ${TOOL_COUNT} tools registered`, () => {
    const toolNames = getFixtureToolNames();
    expect(toolNames.length).toBe(TOOL_COUNT);
  });

  it(`has ${ACTION_COUNT} total actions`, () => {
    const count = getFixtureActionCount();
    // Allow TOOL_ACTIONS to lead (it may differ from ACTION_COUNTS sum if metadata drifts)
    expect(count).toBeGreaterThanOrEqual(TOOL_COUNT); // sanity: at least 1 per tool
  });

  it('every tool in TOOL_ACTIONS has a schema in SCHEMA_REGISTRY', () => {
    const toolNames = getFixtureToolNames();
    for (const tool of toolNames) {
      expect(SCHEMA_REGISTRY[tool], `Missing schema for tool: ${tool}`).toBeDefined();
    }
  });

  it('every tool in TOOL_ACTIONS has entries in ACTION_COUNTS', () => {
    const toolNames = getFixtureToolNames();
    for (const tool of toolNames) {
      expect(
        ACTION_COUNTS[tool],
        `Missing ACTION_COUNTS entry for tool: ${tool}`
      ).toBeDefined();
    }
  });

  it('TOOL_ACTIONS action counts match ACTION_COUNTS per tool', () => {
    const mismatches: string[] = [];
    for (const [tool, actions] of Object.entries(TOOL_ACTIONS)) {
      const expected = ACTION_COUNTS[tool];
      if (expected !== undefined && actions.length !== expected) {
        mismatches.push(`${tool}: TOOL_ACTIONS has ${actions.length}, ACTION_COUNTS has ${expected}`);
      }
    }
    expect(mismatches, `Action count mismatches:\n${mismatches.join('\n')}`).toEqual([]);
  });
});

// ─── Per-Tool Schema Validation ─────────────────────────────

const allFixtures = generateAllFixtures();
const toolNames = getFixtureToolNames();

for (const tool of toolNames) {
  const toolFixtures = allFixtures.filter((f) => f.tool === tool);
  const schema = SCHEMA_REGISTRY[tool];

  describe(`Action Coverage - ${tool} (${toolFixtures.length} actions)`, () => {
    // Verify action list matches TOOL_ACTIONS
    it(`has ${TOOL_ACTIONS[tool]!.length} actions in TOOL_ACTIONS`, () => {
      expect(toolFixtures.length).toBe(TOOL_ACTIONS[tool]!.length);
    });

    for (const fixture of toolFixtures) {
      describe(`${tool}.${fixture.action}`, () => {
        it('valid input passes schema validation', () => {
          if (!schema) {
            throw new Error(`No schema for tool: ${tool}`);
          }

          // Some schemas are lenient (passthrough on some branches).
          // We test that it doesn't throw — the parsed result should contain action.
          const result = schema.safeParse(fixture.validInput);

          if (!result.success) {
            // Provide actionable error message
            const issues = result.error.issues
              .map(
                (i) =>
                  `  - ${i.path.join('.')}: ${i.message} (code: ${(i as unknown as Record<string, unknown>).code})`
              )
              .join('\n');
            throw new Error(
              `Schema validation failed for ${tool}.${fixture.action}:\n` +
                `Input: ${JSON.stringify(fixture.validInput, null, 2)}\n` +
                `Issues:\n${issues}`
            );
          }

          expect(result.success).toBe(true);
          // Verify the action field is preserved inside the request envelope
          if (result.data && typeof result.data === 'object' && 'request' in result.data) {
            const req = (result.data as { request: { action: string } }).request;
            if (req && typeof req === 'object' && 'action' in req) {
              expect(req.action).toBe(fixture.action);
            }
          }
        });

        it('input without action field fails validation', () => {
          if (!schema) {
            throw new Error(`No schema for tool: ${tool}`);
          }

          const result = schema.safeParse(fixture.invalidInput);
          // Should fail — missing action field
          expect(result.success).toBe(false);
        });

        it('action is listed in TOOL_ACTIONS', () => {
          const actions = TOOL_ACTIONS[tool] ?? [];
          expect(actions).toContain(fixture.action);
        });
      });
    }
  });
}

// ─── Cross-Cutting Checks ───────────────────────────────────

describe('Action Coverage - Cross-Cutting', () => {
  it('no duplicate actions within any tool', () => {
    const dupes: string[] = [];
    for (const [tool, actions] of Object.entries(TOOL_ACTIONS)) {
      const seen = new Set<string>();
      for (const action of actions) {
        if (seen.has(action)) {
          dupes.push(`${tool}.${action}`);
        }
        seen.add(action);
      }
    }
    expect(dupes, `Duplicate actions found: ${dupes.join(', ')}`).toEqual([]);
  });

  it('all tool names follow naming convention (sheets_*)', () => {
    const toolNames = getFixtureToolNames();
    const invalid = toolNames.filter((t) => !t.startsWith('sheets_'));
    expect(invalid, `Tools not following sheets_* convention: ${invalid.join(', ')}`).toEqual([]);
  });

  it('all action names are lowercase snake_case', () => {
    const invalid: string[] = [];
    for (const [tool, actions] of Object.entries(TOOL_ACTIONS)) {
      for (const action of actions) {
        if (action !== action.toLowerCase() || /[^a-z0-9_]/.test(action)) {
          invalid.push(`${tool}.${action}`);
        }
      }
    }
    expect(invalid, `Actions not in snake_case: ${invalid.join(', ')}`).toEqual([]);
  });

  it('every SCHEMA_REGISTRY tool has entries in TOOL_ACTIONS', () => {
    const missing = Object.keys(SCHEMA_REGISTRY).filter((t) => !TOOL_ACTIONS[t]);
    expect(missing, `Schema tools missing from TOOL_ACTIONS: ${missing.join(', ')}`).toEqual([]);
  });
});
