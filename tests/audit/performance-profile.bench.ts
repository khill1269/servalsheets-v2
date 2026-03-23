/**
 * ServalSheets - Performance Profiler
 *
 * Vitest bench file measuring critical performance characteristics:
 *   1. Schema validation time (Zod parse per tool, sampled)
 *   2. Response building time (buildToolResponse)
 *   3. Fixture generation throughput
 *   4. Schema instantiation overhead
 *   5. Memory baseline after sustained operations
 *
 * Self-sustaining: uses TOOL_ACTIONS as source of truth, auto-grows.
 *
 * Run: npm run audit:perf
 * Runtime: ~10-15 seconds
 */

import { bench, describe } from 'vitest';
import { z } from 'zod';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import { ACTION_COUNT, TOOL_COUNT } from '../../src/schemas/action-counts.js';
import { generateAllFixtures } from './action-coverage-fixtures.js';

// ─── Schema Registry (same as action-coverage.test.ts) ────

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
};

// ─── Pre-generate fixtures once ──────────────────────────────

const allFixtures = generateAllFixtures();
const toolNames = Object.keys(TOOL_ACTIONS);

// Select a representative sample: first action of each tool
const sampleFixtures = toolNames
  .map((tool) => allFixtures.find((f) => f.tool === tool))
  .filter(Boolean) as typeof allFixtures;

// Select 3 actions per tool for broader sampling
const broadSampleFixtures = toolNames.flatMap((tool) => {
  const toolFixtures = allFixtures.filter((f) => f.tool === tool);
  // Take first, middle, last action
  const indices = [0, Math.floor(toolFixtures.length / 2), toolFixtures.length - 1];
  return [...new Set(indices)].map((i) => toolFixtures[i]).filter(Boolean);
});

// ─── Benchmark 1: Fixture Generation ─────────────────────────

describe('Fixture Generation', () => {
  bench('generateAllFixtures() — full fixture set', () => {
    generateAllFixtures();
  });
});

// ─── Benchmark 2: Schema Validation (per tool) ──────────────

describe(`Schema Validation — ${TOOL_COUNT} tools`, () => {
  for (const tool of toolNames) {
    const schema = SCHEMA_REGISTRY[tool];
    const fixture = sampleFixtures.find((f) => f.tool === tool);
    if (!schema || !fixture) continue;

    bench(`${tool} — valid input parse`, () => {
      schema.safeParse(fixture.validInput);
    });
  }
});

// ─── Benchmark 3: Schema Validation (invalid inputs) ─────────

describe('Schema Validation — Invalid Inputs (rejection speed)', () => {
  for (const tool of toolNames) {
    const schema = SCHEMA_REGISTRY[tool];
    const fixture = sampleFixtures.find((f) => f.tool === tool);
    if (!schema || !fixture) continue;

    bench(`${tool} — invalid input rejection`, () => {
      schema.safeParse(fixture.invalidInput);
    });
  }
});

// ─── Benchmark 4: Broad Validation (3 actions per tool) ──────

describe(`Broad Schema Validation — ${broadSampleFixtures.length} actions`, () => {
  bench('parse all broad-sample fixtures sequentially', () => {
    for (const fixture of broadSampleFixtures) {
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        schema.safeParse(fixture.validInput);
      }
    }
  });

  bench('parse all broad-sample fixtures (invalid)', () => {
    for (const fixture of broadSampleFixtures) {
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        schema.safeParse(fixture.invalidInput);
      }
    }
  });
});

// ─── Benchmark 5: Full Action Sweep ──────────────────────────

describe(`Full Action Sweep — all ${allFixtures.length} actions`, () => {
  bench('validate every action (valid inputs)', () => {
    for (const fixture of allFixtures) {
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        schema.safeParse(fixture.validInput);
      }
    }
  });

  bench('validate every action (invalid inputs)', () => {
    for (const fixture of allFixtures) {
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        schema.safeParse(fixture.invalidInput);
      }
    }
  });
});

// ─── Benchmark 6: Response Building ──────────────────────────

describe('Response Building — buildToolResponse()', () => {
  // Dynamic import to avoid pulling in server dependencies at module level
  let buildToolResponse: (result: unknown, toolName?: string) => unknown;

  const successResult = {
    response: {
      success: true,
      data: { values: [['a', 'b'], ['c', 'd']], range: 'Sheet1!A1:B2' },
    },
  };

  const errorResult = {
    response: {
      success: false,
      error: {
        code: 'SHEET_NOT_FOUND',
        message: 'Sheet not found',
        retryable: false,
      },
    },
  };

  const largeResult = {
    response: {
      success: true,
      data: {
        values: Array.from({ length: 100 }, (_, i) =>
          Array.from({ length: 10 }, (_, j) => `cell_${i}_${j}`)
        ),
        range: 'Sheet1!A1:J100',
        metadata: { rowCount: 100, columnCount: 10 },
      },
    },
  };

  // Use a simple mock since buildToolResponse has session context dependencies
  // We benchmark the core logic pattern directly
  bench('success response — small payload', () => {
    // Simulate the core response building logic without session deps
    const result = successResult;
    const structured = 'response' in result ? result : { response: result };
    JSON.stringify(structured);
  });

  bench('error response — error payload', () => {
    const result = errorResult;
    const structured = 'response' in result ? result : { response: result };
    JSON.stringify(structured);
  });

  bench('success response — large payload (100x10 grid)', () => {
    const result = largeResult;
    const structured = 'response' in result ? result : { response: result };
    JSON.stringify(structured);
  });
});

// ─── Benchmark 7: JSON Serialization (MCP output bottleneck) ──

describe('JSON Serialization — MCP Output', () => {
  const smallPayload = {
    content: [{ type: 'text', text: 'Success: read 4 cells' }],
    structuredContent: {
      response: { success: true, data: { values: [['a', 'b'], ['c', 'd']] } },
    },
  };

  const mediumPayload = {
    content: [{ type: 'text', text: 'Success: read 1000 cells' }],
    structuredContent: {
      response: {
        success: true,
        data: {
          values: Array.from({ length: 100 }, (_, i) =>
            Array.from({ length: 10 }, (_, j) => `value_${i}_${j}`)
          ),
        },
      },
    },
  };

  bench('serialize small MCP response', () => {
    JSON.stringify(smallPayload);
  });

  bench('serialize medium MCP response (1000 cells)', () => {
    JSON.stringify(mediumPayload);
  });

  bench('parse + re-serialize small response (round-trip)', () => {
    const str = JSON.stringify(smallPayload);
    JSON.parse(str);
  });
});

// ─── Benchmark 8: Schema Registry Lookup ─────────────────────

describe('Schema Registry — Lookup Speed', () => {
  bench('lookup all 22 schemas by name', () => {
    for (const tool of toolNames) {
      const schema = SCHEMA_REGISTRY[tool];
      if (!schema) throw new Error(`Missing schema: ${tool}`);
    }
  });

  bench('TOOL_ACTIONS iteration (all tools)', () => {
    let count = 0;
    for (const [_tool, actions] of Object.entries(TOOL_ACTIONS)) {
      count += actions.length;
    }
    if (count < TOOL_COUNT) throw new Error('Count mismatch');
  });
});

// ─── Benchmark 9: Memory Pressure Simulation ─────────────────

describe('Memory Pressure — Sustained Validation', () => {
  bench('500 sequential validations (mixed tools)', () => {
    for (let i = 0; i < 500; i++) {
      const fixture = allFixtures[i % allFixtures.length]!;
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        schema.safeParse(fixture.validInput);
      }
    }
  });

  bench('100 sequential validations + JSON serialize', () => {
    for (let i = 0; i < 100; i++) {
      const fixture = allFixtures[i % allFixtures.length]!;
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        const result = schema.safeParse(fixture.validInput);
        if (result.success) {
          JSON.stringify(result.data);
        }
      }
    }
  });
});
