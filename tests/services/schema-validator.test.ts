/**
 * ServalSheets - SchemaValidator Tests
 *
 * Comprehensive tests for API schema validation and migration planning
 * Tests schema comparison, issue detection, migration plan generation, and recommendations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SchemaValidator, type MigrationPlan } from '../../src/services/schema-validator.js';
import {
  DiscoveryApiClient,
  type DiscoverySchema,
  type SchemaComparison,
} from '../../src/services/discovery-client.js';
import { SchemaCache } from '../../src/services/schema-cache.js';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;
  let mockDiscoveryClient: Partial<DiscoveryApiClient>;
  let mockSchemaCache: Partial<SchemaCache>;

  // Mock schemas
  const mockCurrentSchema: DiscoverySchema = {
    kind: 'discovery#restDescription',
    discoveryVersion: 'v1',
    id: 'sheets:v4',
    name: 'sheets',
    version: 'v4',
    title: 'Google Sheets API',
    description: 'Reads and writes Google Sheets.',
    ownerDomain: 'google.com',
    ownerName: 'Google',
    documentationLink: 'https://developers.google.com/sheets/',
    protocol: 'rest',
    baseUrl: 'https://sheets.googleapis.com/',
    basePath: '',
    rootUrl: 'https://sheets.googleapis.com/',
    servicePath: '',
    batchPath: 'batch',
    parameters: {},
    auth: { oauth2: { scopes: {} } },
    schemas: {
      Spreadsheet: {
        id: 'Spreadsheet',
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
          properties: { $ref: 'SpreadsheetProperties' },
          sheets: { type: 'array', items: { $ref: 'Sheet' } },
        },
      },
    },
    resources: {
      spreadsheets: {
        methods: {
          get: {
            id: 'sheets.spreadsheets.get',
            path: 'v4/spreadsheets/{spreadsheetId}',
            httpMethod: 'GET',
            description: 'Returns a spreadsheet',
            parameters: {},
            parameterOrder: ['spreadsheetId'],
            response: { $ref: 'Spreadsheet' },
          },
        },
      },
    },
  };

  const mockNewSchema: DiscoverySchema = {
    ...mockCurrentSchema,
    schemas: {
      ...mockCurrentSchema.schemas,
      Spreadsheet: {
        id: 'Spreadsheet',
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
          properties: { $ref: 'SpreadsheetProperties' },
          sheets: { type: 'array', items: { $ref: 'Sheet' } },
          // New field
          metadata: { type: 'object', description: 'Additional metadata' },
        },
      },
    },
  };

  beforeEach(() => {
    mockDiscoveryClient = {
      isEnabled: vi.fn().mockReturnValue(true),
      getApiSchema: vi.fn().mockResolvedValue(mockCurrentSchema),
      compareSchemas: vi.fn().mockReturnValue({
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: 'No changes detected',
      } satisfies SchemaComparison),
    };

    mockSchemaCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    validator = new SchemaValidator({
      discoveryClient: mockDiscoveryClient as DiscoveryApiClient,
      schemaCache: mockSchemaCache as SchemaCache,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Validate Against Current', () => {
    it('should validate sheets API successfully', async () => {
      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.recommendation).toContain('valid and compatible');
      expect(mockDiscoveryClient.getApiSchema).toHaveBeenCalledWith('sheets', 'v4');
    });

    it('should validate drive API successfully', async () => {
      const result = await validator.validateAgainstCurrent('drive');

      expect(result.valid).toBe(true);
      expect(mockDiscoveryClient.getApiSchema).toHaveBeenCalledWith('drive', 'v3');
    });

    it('should handle Discovery API not enabled', async () => {
      mockDiscoveryClient.isEnabled = vi.fn().mockReturnValue(false);

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.severity).toBe('info');
      expect(result.issues[0]?.message).toContain('Discovery API is not enabled');
      expect(result.recommendation).toContain('Enable Discovery API');
    });

    it('should use cached schema if available', async () => {
      mockSchemaCache.get = vi.fn().mockResolvedValue(mockCurrentSchema);

      await validator.validateAgainstCurrent('sheets');

      expect(mockSchemaCache.get).toHaveBeenCalledWith('sheets', 'v4');
      expect(mockDiscoveryClient.getApiSchema).not.toHaveBeenCalled();
    });

    it('should cache fetched schema', async () => {
      mockSchemaCache.get = vi.fn().mockResolvedValue(null);

      await validator.validateAgainstCurrent('sheets');

      expect(mockSchemaCache.set).toHaveBeenCalledWith('sheets', 'v4', mockCurrentSchema);
    });

    it('should detect missing schemas', async () => {
      const schemaWithoutTypes = { ...mockCurrentSchema, schemas: {} };
      mockDiscoveryClient.getApiSchema = vi.fn().mockResolvedValue(schemaWithoutTypes);

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.path === 'schemas')).toBe(true);
    });

    it('should detect missing resources', async () => {
      const schemaWithoutResources = { ...mockCurrentSchema, resources: {} };
      mockDiscoveryClient.getApiSchema = vi.fn().mockResolvedValue(schemaWithoutResources);

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.path === 'resources')).toBe(true);
    });

    it('should handle validation errors', async () => {
      mockDiscoveryClient.getApiSchema = vi.fn().mockRejectedValue(new Error('API error'));

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.severity).toBe('critical');
      expect(result.issues[0]?.message).toContain('Failed to validate schema');
    });
  });

  describe('Schema Comparison', () => {
    it('should compare schemas and detect no changes', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: 'No changes detected',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.comparison).toEqual(comparison);
      expect(result.recommendation).toContain('No significant changes');
    });

    it('should detect new fields', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [
          { path: 'Spreadsheet.metadata', type: 'object', description: 'Additional metadata' },
        ],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '1 new field',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.type).toBe('new_feature');
      expect(result.issues[0]?.severity).toBe('info');
      expect(result.recommendation).toContain('New features available');
    });

    it('should detect deprecated fields (medium severity)', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [
          {
            path: 'Spreadsheet.legacyField',
            deprecationMessage: 'Use newField instead',
            removalDate: '2025-12-31',
          },
        ],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '1 deprecated field',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.type).toBe('deprecation');
      expect(result.issues[0]?.severity).toBe('medium');
      expect(result.issues[0]?.suggestedAction).toContain('Stop using this field');
    });

    it('should detect type changes (high severity)', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [{ path: 'Spreadsheet.rowCount', oldType: 'integer', newType: 'string' }],
        newMethods: [],
        removedMethods: [],
        summary: '1 type change',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(true); // High but not critical
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.type).toBe('type_change');
      expect(result.issues[0]?.severity).toBe('high');
      expect(result.recommendation).toContain('WARNING');
    });

    it('should detect removed methods (critical severity)', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: ['spreadsheets.batchUpdate'],
        summary: '1 removed method',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(false); // Critical = invalid
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.type).toBe('breaking_change');
      expect(result.issues[0]?.severity).toBe('critical');
      expect(result.recommendation).toContain('CRITICAL');
    });

    it('should detect new methods', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [
          {
            name: 'spreadsheets.export',
            description: 'Export spreadsheet to various formats',
            path: 'v4/spreadsheets/{spreadsheetId}/export',
          },
        ],
        removedMethods: [],
        summary: '1 new method',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.type).toBe('new_feature');
      expect(result.issues[0]?.severity).toBe('info');
    });

    it('should handle multiple issues with different severities', async () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [{ path: 'Spreadsheet.newField', type: 'string', description: 'New field' }],
        deprecatedFields: [
          {
            path: 'Spreadsheet.oldField',
            deprecationMessage: 'Deprecated',
            removalDate: '2025-12-31',
          },
        ],
        changedFields: [{ path: 'Spreadsheet.count', oldType: 'integer', newType: 'string' }],
        newMethods: [{ name: 'spreadsheets.new', description: 'New method', path: 'v4/new' }],
        removedMethods: ['spreadsheets.old'],
        summary: '5 changes',
      };

      mockDiscoveryClient.compareSchemas = vi.fn().mockReturnValue(comparison);

      const result = await validator.compareSchemas('sheets', mockCurrentSchema, mockNewSchema);

      expect(result.valid).toBe(false); // Has critical (removed method)
      expect(result.issues).toHaveLength(5);
      expect(result.issues.filter((i) => i.severity === 'critical')).toHaveLength(1);
      expect(result.issues.filter((i) => i.severity === 'high')).toHaveLength(1);
      expect(result.issues.filter((i) => i.severity === 'medium')).toHaveLength(1);
      expect(result.issues.filter((i) => i.severity === 'info')).toHaveLength(2);
    });
  });

  describe('Migration Plan Generation', () => {
    it('should generate plan with no changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: 'No changes',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.api).toBe('sheets');
      expect(plan.version).toBe('v4');
      expect(plan.hasBreakingChanges).toBe(false);
      expect(plan.estimatedEffort).toBe('low');
      // Should still have test, docs, verification steps
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('should generate plan for deprecated fields', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [
          {
            path: 'Spreadsheet.oldField',
            deprecationMessage: 'Use newField',
            removalDate: '2025-12-31',
          },
        ],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '1 deprecated field',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(true);
      expect(plan.steps.some((s) => s.title.includes('Deprecated'))).toBe(true);
      const deprecationStep = plan.steps.find((s) => s.title.includes('Deprecated'));
      expect(deprecationStep?.priority).toBe('required');
      expect(deprecationStep?.category).toBe('code_change');
      expect(deprecationStep?.codeExample).toBeDefined();
    });

    it('should generate plan for type changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [
          { path: 'Spreadsheet.count', oldType: 'integer', newType: 'string' },
          { path: 'Spreadsheet.index', oldType: 'number', newType: 'string' },
        ],
        newMethods: [],
        removedMethods: [],
        summary: '2 type changes',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(true);
      const typeChangeStep = plan.steps.find((s) => s.title.includes('Field Types'));
      expect(typeChangeStep).toBeDefined();
      expect(typeChangeStep?.priority).toBe('required');
      expect(typeChangeStep?.estimatedTime).toContain('40'); // 2 fields * 20 min
      expect(typeChangeStep?.codeExample).toBeDefined();
    });

    it('should generate plan for new fields (optional priority)', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [
          { path: 'Spreadsheet.newField1', type: 'string', description: 'New field 1' },
          { path: 'Spreadsheet.newField2', type: 'object', description: 'New field 2' },
        ],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '2 new fields',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(false);
      const newFieldStep = plan.steps.find((s) => s.title.includes('New Fields'));
      expect(newFieldStep).toBeDefined();
      expect(newFieldStep?.priority).toBe('optional');
      expect(newFieldStep?.estimatedTime).toContain('60'); // 2 fields * 30 min
    });

    it('should generate plan for new methods (recommended priority)', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [{ name: 'spreadsheets.export', description: 'Export', path: 'v4/export' }],
        removedMethods: [],
        summary: '1 new method',
      };

      const plan = validator.generateMigrationPlan(comparison);

      const newMethodStep = plan.steps.find((s) => s.title.includes('New API Methods'));
      expect(newMethodStep).toBeDefined();
      expect(newMethodStep?.priority).toBe('recommended');
      expect(newMethodStep?.estimatedTime).toContain('60'); // 1 method * 60 min
    });

    it('should generate plan for removed methods', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: ['spreadsheets.old', 'spreadsheets.legacy'],
        summary: '2 removed methods',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(true);
      const removedMethodStep = plan.steps.find((s) => s.title.includes('Deleted Methods'));
      expect(removedMethodStep).toBeDefined();
      expect(removedMethodStep?.priority).toBe('required');
      expect(removedMethodStep?.estimatedTime).toContain('90'); // 2 methods * 45 min
    });

    it('should always include test, docs, and verification steps', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: 'No changes',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.steps.some((s) => s.category === 'test_update')).toBe(true);
      expect(plan.steps.some((s) => s.category === 'documentation')).toBe(true);
      expect(plan.steps.some((s) => s.category === 'verification')).toBe(true);
    });

    it('should calculate low effort for <5 non-breaking changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [
          { path: 'Field1', type: 'string', description: 'New' },
          { path: 'Field2', type: 'string', description: 'New' },
        ],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '2 new fields',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.estimatedEffort).toBe('low');
    });

    it('should calculate medium effort for 5-14 non-breaking changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: Array.from({ length: 10 }, (_, i) => ({
          path: `Field${i}`,
          type: 'string',
          description: 'New',
        })),
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '10 new fields',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.estimatedEffort).toBe('medium');
    });

    it('should calculate high effort for >15 changes or breaking changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: Array.from({ length: 20 }, (_, i) => ({
          path: `Field${i}`,
          type: 'string',
          description: 'New',
        })),
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '20 new fields',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.estimatedEffort).toBe('high');
    });

    it('should include affected files for sheets API', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: 'No changes',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.affectedFiles.some((f) => f.includes('google-api'))).toBe(true);
      expect(plan.affectedFiles.some((f) => f.includes('spreadsheet'))).toBe(true);
      expect(plan.affectedFiles.some((f) => f.includes('values'))).toBe(true);
    });

    it('should include affected files for drive API', () => {
      const comparison: SchemaComparison = {
        api: 'drive',
        version: 'v3',
        timestamp: 1704067200000,
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: 'No changes',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.affectedFiles.some((f) => f.includes('sharing'))).toBe(true);
    });

    it('should include testing requirements', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        timestamp: 1704067200000,
        newFields: [{ path: 'Field1', type: 'string', description: 'New' }],
        deprecatedFields: [
          { path: 'Field2', deprecationMessage: 'Old', removalDate: '2025-12-31' },
        ],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        summary: '2 changes',
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.testingRequired.some((t) => t.includes('full test suite'))).toBe(true);
      expect(plan.testingRequired.some((t) => t.includes('new functionality'))).toBe(true);
      expect(plan.testingRequired.some((t) => t.includes('integration tests'))).toBe(true);
    });
  });

  describe('Migration Report Formatting', () => {
    it('should format basic report', () => {
      const plan: MigrationPlan = {
        api: 'sheets',
        version: 'v4',
        hasBreakingChanges: false,
        estimatedEffort: 'low',
        steps: [
          {
            order: 1,
            title: 'Update Test Suite',
            description: 'Update tests',
            category: 'test_update',
            priority: 'required',
            estimatedTime: '1 hour',
          },
        ],
        affectedFiles: ['src/handlers/core.ts'],
        testingRequired: ['Run full test suite'],
      };

      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('# Migration Plan: SHEETS API v4');
      expect(report).toContain('**Status**: ✅ Non-Breaking');
      expect(report).toContain('**Effort**: LOW');
      expect(report).toContain('## Overview');
      expect(report).toContain('## Migration Steps');
      expect(report).toContain('### 1. 🔴 Update Test Suite');
      expect(report).toContain('## Affected Files');
      expect(report).toContain('## Testing Required');
    });

    it('should show warning for breaking changes', () => {
      const plan: MigrationPlan = {
        api: 'sheets',
        version: 'v4',
        hasBreakingChanges: true,
        estimatedEffort: 'high',
        steps: [],
        affectedFiles: [],
        testingRequired: [],
      };

      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('**Status**: ⚠️ Breaking Changes');
      expect(report).toContain('⚠️ **WARNING**');
    });

    it('should use correct emoji for priority', () => {
      const plan: MigrationPlan = {
        api: 'sheets',
        version: 'v4',
        hasBreakingChanges: false,
        estimatedEffort: 'medium',
        steps: [
          {
            order: 1,
            title: 'Required Step',
            description: 'Must do',
            category: 'code_change',
            priority: 'required',
            estimatedTime: '1 hour',
          },
          {
            order: 2,
            title: 'Recommended Step',
            description: 'Should do',
            category: 'code_change',
            priority: 'recommended',
            estimatedTime: '1 hour',
          },
          {
            order: 3,
            title: 'Optional Step',
            description: 'Could do',
            category: 'code_change',
            priority: 'optional',
            estimatedTime: '1 hour',
          },
        ],
        affectedFiles: [],
        testingRequired: [],
      };

      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('🔴'); // required
      expect(report).toContain('🟡'); // recommended
      expect(report).toContain('🟢'); // optional
    });

    it('should include code examples when present', () => {
      const plan: MigrationPlan = {
        api: 'sheets',
        version: 'v4',
        hasBreakingChanges: false,
        estimatedEffort: 'low',
        steps: [
          {
            order: 1,
            title: 'Fix Type',
            description: 'Update type',
            category: 'code_change',
            priority: 'required',
            estimatedTime: '30 min',
            codeExample: 'const value: string = data.field;',
          },
        ],
        affectedFiles: [],
        testingRequired: [],
      };

      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('```typescript');
      expect(report).toContain('const value: string = data.field;');
    });
  });

  describe('Strict Mode', () => {
    it('should create validator in strict mode', () => {
      const strictValidator = new SchemaValidator({ strictMode: true });

      expect(strictValidator).toBeDefined();
    });
  });
});
