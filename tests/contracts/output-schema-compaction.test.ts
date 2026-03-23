/**
 * Output Schema Compaction Contract Tests
 *
 * Verifies that the response compactor preserves schema-required fields:
 * 1. PRESERVED_FIELDS objects are never converted to strings
 * 2. CONDITIONAL_FIELDS arrays remain arrays (not wrapped in objects)
 * 3. ESSENTIAL_FIELDS are always included
 * 4. Error responses are never broken by compaction
 *
 * @module tests/contracts/output-schema-compaction
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compactResponse } from '../../src/utils/response-compactor.js';

// Enable compact mode for these tests (global setup.ts disables it)
let originalCompactValue: string | undefined;
beforeAll(() => {
  originalCompactValue = process.env['COMPACT_RESPONSES'];
  delete process.env['COMPACT_RESPONSES']; // default is enabled
});
afterAll(() => {
  if (originalCompactValue !== undefined) {
    process.env['COMPACT_RESPONSES'] = originalCompactValue;
  } else {
    delete process.env['COMPACT_RESPONSES'];
  }
});

// Output schemas for error response validation
import { SheetsCoreOutputSchema } from '../../src/schemas/core.js';
import { SheetsDataOutputSchema } from '../../src/schemas/data.js';
import { SheetsFormatOutputSchema } from '../../src/schemas/format.js';
import { SheetsDimensionsOutputSchema } from '../../src/schemas/dimensions.js';
import { SheetsVisualizeOutputSchema } from '../../src/schemas/visualize.js';
import { SheetsCollaborateOutputSchema } from '../../src/schemas/collaborate.js';
import { SheetsAdvancedOutputSchema } from '../../src/schemas/advanced.js';
import { SheetsTransactionOutputSchema } from '../../src/schemas/transaction.js';
import { SheetsQualityOutputSchema } from '../../src/schemas/quality.js';
import { SheetsHistoryOutputSchema } from '../../src/schemas/history.js';
import { SheetsConfirmOutputSchema } from '../../src/schemas/confirm.js';
import { SheetsAnalyzeOutputSchema } from '../../src/schemas/analyze.js';
import { SheetsFixOutputSchema } from '../../src/schemas/fix.js';
import { SheetsSessionOutputSchema } from '../../src/schemas/session.js';
import { SheetsTemplatesOutputSchema } from '../../src/schemas/templates.js';
import { SheetsBigQueryOutputSchema } from '../../src/schemas/bigquery.js';
import { SheetsAppsScriptOutputSchema } from '../../src/schemas/appsscript.js';
import { SheetsWebhookOutputSchema } from '../../src/schemas/webhook.js';
import { SheetsDependenciesOutputSchema } from '../../src/schemas/dependencies.js';
import { SheetsAuthOutputSchema } from '../../src/schemas/auth.js';

// ============================================================================
// HELPERS
// ============================================================================

type ResponseWrapper = { response: Record<string, unknown> };

/**
 * Build a response with a large object field (>500 bytes) to test compaction.
 * The compactor must keep object types intact even when it trims nested data.
 */
function buildLargeObjectResponse(fieldName: string): ResponseWrapper {
  return {
    response: {
      success: true,
      action: 'test',
      [fieldName]: {
        id: 'test-id-12345',
        title: 'A test object with enough data to exceed 500 bytes',
        description: 'x'.repeat(200),
        metadata: {
          created: '2026-01-01T00:00:00Z',
          updated: '2026-02-01T00:00:00Z',
          version: 42,
          tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
        },
        config: {
          enabled: true,
          maxItems: 100,
          format: 'json',
          locale: 'en_US',
          timeZone: 'UTC',
        },
      },
    },
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Output Schema Compaction Contracts', () => {
  describe('Object Fields - objects must never be stringified', () => {
    const preservedFields = [
      'spreadsheet', // sheets_core: get, create, copy
      'spreadsheets', // sheets_core: batch_get
      'comprehensiveMetadata', // sheets_core: get_comprehensive
      'formula', // sheets_analyze: generate_formula
      'scout', // sheets_analyze: scout
      'plan', // sheets_analyze: plan
      'operations', // sheets_fix: fix preview
      'pivotTable', // sheets_visualize: pivot_create
      'filter', // sheets_dimensions: get_basic_filter
    ];

    for (const field of preservedFields) {
      it(`preserves ${field} as object after compaction (>500 bytes)`, () => {
        const response = buildLargeObjectResponse(field);
        // Verify test data is >500 bytes
        expect(JSON.stringify(response.response[field]).length).toBeGreaterThan(500);

        const compacted = compactResponse(response) as ResponseWrapper;

        // Must remain an object, not '[object truncated]'
        expect(typeof compacted.response[field]).toBe('object');
        expect(compacted.response[field]).not.toBe('[object truncated]');
        // Verify the object content is intact
        expect((compacted.response[field] as Record<string, unknown>).id).toBe('test-id-12345');
      });
    }

    it('non-preserved field >500 bytes stays an object after compaction', () => {
      const response = buildLargeObjectResponse('someRandomField');
      expect(JSON.stringify(response.response.someRandomField).length).toBeGreaterThan(500);

      const compacted = compactResponse(response) as ResponseWrapper;

      expect(typeof compacted.response.someRandomField).toBe('object');
      expect(compacted.response.someRandomField).not.toBe('[object truncated]');
    });
  });

  describe('CONDITIONAL_FIELDS - arrays preserved with correct structure', () => {
    const conditionalArrayFields = [
      'values',
      'data',
      'sheets',
      'charts',
      'items',
      'results',
      'permissions',
      'comments',
      'revisions',
      'namedRanges',
      'protectedRanges',
      'filterViews',
      'valueRanges',
      'templates',
      'webhooks',
      'validations',
      'conditionalFormats',
      'pivotTables',
      'dataSourceTables',
      'deployments',
      'versions',
      'processes',
      'suggestions',
      'columnsMatched',
      'columnsCreated',
      'columnsSkipped',
    ];

    for (const field of conditionalArrayFields) {
      it(`preserves ${field} as array (small array, <=10 items)`, () => {
        const response: ResponseWrapper = {
          response: {
            success: true,
            action: 'test',
            [field]: [{ id: 1 }, { id: 2 }, { id: 3 }],
          },
        };

        const compacted = compactResponse(response) as ResponseWrapper;
        expect(Array.isArray(compacted.response[field])).toBe(true);
        expect(compacted.response[field]).toHaveLength(3);
      });
    }

    it('truncates large 2D values array but keeps array structure', () => {
      const largeValues = Array.from({ length: 200 }, (_, i) => [`row${i}`, `data${i}`, `col${i}`]);
      const response: ResponseWrapper = {
        response: {
          success: true,
          action: 'read',
          values: largeValues,
        },
      };

      const compacted = compactResponse(response) as ResponseWrapper;
      expect(Array.isArray(compacted.response.values)).toBe(true);
      expect((compacted.response.values as unknown[]).length).toBeLessThan(largeValues.length);
    });
  });

  describe('ESSENTIAL_FIELDS - always included', () => {
    const essentialFields = ['success', 'action', 'message', 'error', 'authenticated'];

    for (const field of essentialFields) {
      it(`preserves ${field} field in compacted output`, () => {
        const response: ResponseWrapper = {
          response: {
            success: true,
            action: 'test',
            [field]: field === 'success' ? true : `test-${field}`,
            // Add a large object that would normally be stripped
            _meta: { requestId: 'req-123', timing: { total: 42 } },
            costEstimate: { apiCalls: 1, estimatedCost: 0.001 },
          },
        };

        const compacted = compactResponse(response) as ResponseWrapper;
        expect(compacted.response[field]).toBeDefined();
      });
    }
  });

  describe('STRIPPED_FIELDS - always removed', () => {
    const strippedFields = [
      '_meta',
      'costEstimate',
      'quotaImpact',
      'cacheHit',
      'fetchTime',
      'traceId',
      'spanId',
      'requestId',
      'debugInfo',
    ];

    for (const field of strippedFields) {
      it(`strips ${field} from compacted output`, () => {
        const response: ResponseWrapper = {
          response: {
            success: true,
            action: 'test',
            [field]: { some: 'data' },
          },
        };

        const compacted = compactResponse(response) as ResponseWrapper;
        expect(compacted.response[field]).toBeUndefined();
      });
    }
  });

  describe('Error responses validate against all output schemas', () => {
    const ERROR_RESPONSE = {
      response: {
        success: false as const,
        error: {
          code: 'NOT_FOUND',
          message: 'Spreadsheet not found',
          category: 'client',
          severity: 'medium',
          retryable: false,
        },
      },
    };

    const outputSchemas = [
      { name: 'sheets_core', schema: SheetsCoreOutputSchema },
      { name: 'sheets_data', schema: SheetsDataOutputSchema },
      { name: 'sheets_format', schema: SheetsFormatOutputSchema },
      { name: 'sheets_dimensions', schema: SheetsDimensionsOutputSchema },
      { name: 'sheets_visualize', schema: SheetsVisualizeOutputSchema },
      { name: 'sheets_collaborate', schema: SheetsCollaborateOutputSchema },
      { name: 'sheets_advanced', schema: SheetsAdvancedOutputSchema },
      { name: 'sheets_transaction', schema: SheetsTransactionOutputSchema },
      { name: 'sheets_quality', schema: SheetsQualityOutputSchema },
      { name: 'sheets_history', schema: SheetsHistoryOutputSchema },
      { name: 'sheets_confirm', schema: SheetsConfirmOutputSchema },
      { name: 'sheets_analyze', schema: SheetsAnalyzeOutputSchema },
      { name: 'sheets_fix', schema: SheetsFixOutputSchema },
      { name: 'sheets_session', schema: SheetsSessionOutputSchema },
      { name: 'sheets_templates', schema: SheetsTemplatesOutputSchema },
      { name: 'sheets_bigquery', schema: SheetsBigQueryOutputSchema },
      { name: 'sheets_appsscript', schema: SheetsAppsScriptOutputSchema },
      { name: 'sheets_webhook', schema: SheetsWebhookOutputSchema },
      { name: 'sheets_dependencies', schema: SheetsDependenciesOutputSchema },
      { name: 'sheets_auth', schema: SheetsAuthOutputSchema },
    ];

    for (const { name, schema } of outputSchemas) {
      it(`${name}: error response validates after compaction`, () => {
        const compacted = compactResponse(ERROR_RESPONSE);
        const result = schema.safeParse(compacted);
        if (!result.success) {
          console.error(`${name} error validation failed:`, result.error.issues);
        }
        expect(result.success).toBe(true);
      });
    }
  });

  describe('Success responses validate after compaction', () => {
    it('sheets_data read response remains schema-valid after values truncation', () => {
      const sample = {
        response: {
          success: true as const,
          action: 'read',
          values: Array.from({ length: 200 }, (_, i) => [`row${i}`, `data${i}`, `col${i}`]),
          range: 'Sheet1!A1:C200',
          majorDimension: 'ROWS' as const,
        },
      };

      const compacted = compactResponse(sample);
      expect(SheetsDataOutputSchema.safeParse(compacted).success).toBe(true);
    });

    it('sheets_analyze analyze_quality keeps dataQuality as an object', () => {
      const sample = {
        response: {
          success: true as const,
          action: 'analyze_quality',
          dataQuality: {
            score: 91,
            completeness: 95,
            consistency: 90,
            accuracy: 89,
            issues: Array.from({ length: 12 }, (_, i) => ({
              type: 'MIXED_DATA_TYPES' as const,
              severity: 'medium' as const,
              location: `C${i + 2}`,
              description: 'Issue detected',
              autoFixable: false,
            })),
            summary: 'Quality score: 91%',
          },
        },
      };

      const compacted = compactResponse(sample);
      expect(SheetsAnalyzeOutputSchema.safeParse(compacted).success).toBe(true);
    });

    it('sheets_dependencies model_scenario keeps nested arrays inside response.data', () => {
      const sample = {
        response: {
          success: true as const,
          data: {
            action: 'model_scenario' as const,
            inputChanges: [{ cell: 'Sheet1!B2', from: 95, to: 100 }],
            cascadeEffects: [
              {
                cell: 'Sheet1!C2',
                formula: '=B2*1.1',
                currentValue: 110,
                affectedBy: ['Sheet1!B2'],
              },
            ],
            summary: {
              cellsAffected: 1,
              message: 'Scenario affected 1 downstream cell',
            },
          },
        },
      };

      const compacted = compactResponse(sample);
      expect(SheetsDependenciesOutputSchema.safeParse(compacted).success).toBe(true);
    });

    it('sheets_templates create keeps template as an object', () => {
      const sample = {
        response: {
          success: true as const,
          action: 'create',
          template: {
            id: 'tpl-1',
            name: 'Budget Template',
            description: 'x'.repeat(250),
            category: 'finance',
            version: '1.0.0',
            created: '2026-03-17T10:00:00.000Z',
            updated: '2026-03-17T10:00:00.000Z',
            sheets: [
              {
                name: 'Summary',
                headers: ['Month', 'Budget', 'Actual'],
                rowCount: 12,
                columnCount: 3,
                frozenRowCount: 1,
              },
            ],
            metadata: { notes: 'x'.repeat(250) },
          },
        },
      };

      const compacted = compactResponse(sample);
      expect(SheetsTemplatesOutputSchema.safeParse(compacted).success).toBe(true);
    });

    it('sheets_collaborate comment_add keeps comment as an object', () => {
      const sample = {
        response: {
          success: true as const,
          action: 'comment_add',
          comment: {
            id: 'c1',
            content: 'x'.repeat(400),
            author: {
              displayName: 'Me',
              emailAddress: 'me@example.com',
            },
            createdTime: '2026-03-17T10:00:00Z',
            modifiedTime: '2026-03-17T10:00:00Z',
            resolved: false,
            replies: [
              {
                id: 'r1',
                content: 'Reply',
                author: { displayName: 'You' },
                createdTime: '2026-03-17T10:00:01Z',
              },
            ],
          },
        },
      };

      const compacted = compactResponse(sample);
      expect(SheetsCollaborateOutputSchema.safeParse(compacted).success).toBe(true);
    });

    it('sheets_appsscript get_content keeps files as an array', () => {
      const sample = {
        response: {
          success: true as const,
          action: 'get_content',
          scriptId: 'script-1',
          files: Array.from({ length: 20 }, (_, i) => ({
            name: `File${i}`,
            type: 'SERVER_JS' as const,
            source: `function test${i}() { return ${i}; }`,
          })),
        },
      };

      const compacted = compactResponse(sample);
      expect(SheetsAppsScriptOutputSchema.safeParse(compacted).success).toBe(true);
    });
  });

  describe('verbosity:detailed bypasses compaction', () => {
    it('returns original response unchanged', () => {
      const response: ResponseWrapper = {
        response: {
          success: true,
          action: 'read',
          values: Array.from({ length: 200 }, (_, i) => [`row${i}`, `data${i}`]),
          _meta: { requestId: 'req-123' },
          costEstimate: { apiCalls: 1 },
        },
      };
      const compacted = compactResponse(response, { verbosity: 'detailed' });
      expect(compacted).toEqual(response);
    });
  });

  describe('response wrapper handling', () => {
    it('compacts inner response when wrapped in { response: ... }', () => {
      const response = {
        response: {
          success: true,
          action: 'test',
          _meta: { requestId: 'req-123' },
        },
      };
      const compacted = compactResponse(response) as ResponseWrapper;
      // _meta should be stripped
      expect(compacted.response._meta).toBeUndefined();
      // Essential fields preserved
      expect(compacted.response.success).toBe(true);
      expect(compacted.response.action).toBe('test');
    });
  });
});
