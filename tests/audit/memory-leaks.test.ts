/**
 * ServalSheets - Memory Leak Detector
 *
 * Sustained-load test running 1,000 mocked schema validations:
 *   - Measures heap before/after with forced GC
 *   - Fails if growth > 50MB (indicates leak)
 *   - Checks that validation caches don't grow unbounded
 *   - Verifies fixture generation doesn't accumulate state
 *
 * Self-sustaining: uses TOOL_ACTIONS as source of truth.
 *
 * Run: npm run audit:memory
 * Runtime: ~3-5 seconds
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import { generateAllFixtures } from './action-coverage-fixtures.js';

// ─── Schema Registry ────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────

function getHeapUsedMB(): number {
  // Force GC if available (run with --expose-gc)
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

const MAX_GROWTH_MB = 50;

// ─── Tests ──────────────────────────────────────────────────

describe('Memory Leak Detection', () => {
  it('1,000 schema validations do not leak memory (< 50MB growth)', () => {
    const fixtures = generateAllFixtures();

    // Warm up: run a few validations to stabilize JIT
    for (let i = 0; i < 10; i++) {
      const f = fixtures[i % fixtures.length]!;
      SCHEMA_REGISTRY[f.tool]?.safeParse(f.validInput);
    }

    const heapBefore = getHeapUsedMB();

    // Run 1,000 validations cycling through all fixtures
    for (let i = 0; i < 1000; i++) {
      const fixture = fixtures[i % fixtures.length]!;
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        schema.safeParse(fixture.validInput);
      }
    }

    const heapAfter = getHeapUsedMB();
    const growth = heapAfter - heapBefore;

    expect(
      growth,
      `Heap grew by ${growth.toFixed(2)} MB after 1,000 validations (limit: ${MAX_GROWTH_MB} MB)`
    ).toBeLessThan(MAX_GROWTH_MB);
  });

  it('repeated fixture generation does not accumulate state', () => {
    const heapBefore = getHeapUsedMB();

    // Generate fixtures 50 times — should not accumulate
    for (let i = 0; i < 50; i++) {
      const fixtures = generateAllFixtures();
      // Use the fixtures to prevent dead-code elimination
      if (fixtures.length === 0) throw new Error('No fixtures generated');
    }

    const heapAfter = getHeapUsedMB();
    const growth = heapAfter - heapBefore;

    expect(
      growth,
      `Heap grew by ${growth.toFixed(2)} MB after 50 fixture generations (limit: ${MAX_GROWTH_MB} MB)`
    ).toBeLessThan(MAX_GROWTH_MB);
  });

  it('mixed valid + invalid parsing does not leak error objects', () => {
    const fixtures = generateAllFixtures();

    // Warm up
    for (let i = 0; i < 10; i++) {
      const f = fixtures[i % fixtures.length]!;
      SCHEMA_REGISTRY[f.tool]?.safeParse(f.invalidInput);
    }

    const heapBefore = getHeapUsedMB();

    // Alternate valid/invalid — error objects should be GC'd
    for (let i = 0; i < 1000; i++) {
      const fixture = fixtures[i % fixtures.length]!;
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        if (i % 2 === 0) {
          schema.safeParse(fixture.validInput);
        } else {
          schema.safeParse(fixture.invalidInput);
        }
      }
    }

    const heapAfter = getHeapUsedMB();
    const growth = heapAfter - heapBefore;

    expect(
      growth,
      `Heap grew by ${growth.toFixed(2)} MB after 1,000 mixed validations (limit: ${MAX_GROWTH_MB} MB)`
    ).toBeLessThan(MAX_GROWTH_MB);
  });

  it('JSON serialization cycle does not accumulate buffers', () => {
    const fixtures = generateAllFixtures();
    const heapBefore = getHeapUsedMB();

    // Simulate MCP response building: parse → serialize → parse
    for (let i = 0; i < 500; i++) {
      const fixture = fixtures[i % fixtures.length]!;
      const schema = SCHEMA_REGISTRY[fixture.tool];
      if (schema) {
        const result = schema.safeParse(fixture.validInput);
        if (result.success) {
          const json = JSON.stringify(result.data);
          JSON.parse(json);
        }
      }
    }

    const heapAfter = getHeapUsedMB();
    const growth = heapAfter - heapBefore;

    expect(
      growth,
      `Heap grew by ${growth.toFixed(2)} MB after 500 serialize cycles (limit: ${MAX_GROWTH_MB} MB)`
    ).toBeLessThan(MAX_GROWTH_MB);
  });

  it('TOOL_ACTIONS map is stable across repeated access', () => {
    // Verify TOOL_ACTIONS doesn't create new objects on each access
    const toolNames = Object.keys(TOOL_ACTIONS);

    const heapBefore = getHeapUsedMB();

    for (let i = 0; i < 10000; i++) {
      const tool = toolNames[i % toolNames.length]!;
      const actions = TOOL_ACTIONS[tool]!;
      // Use value to prevent optimization
      if (actions.length === -1) throw new Error('Impossible');
    }

    const heapAfter = getHeapUsedMB();
    const growth = heapAfter - heapBefore;

    // TOOL_ACTIONS is a static map, growth should be negligible
    expect(
      growth,
      `Heap grew by ${growth.toFixed(2)} MB after 10,000 TOOL_ACTIONS accesses`
    ).toBeLessThan(5); // 5MB is extremely generous for static map access
  });
});
