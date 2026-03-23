import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SchemaValidator,
  getSchemaValidator,
  resetSchemaValidator,
} from '../src/services/schema-validator.js';
import {
  DiscoveryApiClient,
  type DiscoverySchema,
  type SchemaComparison,
} from '../src/services/discovery-client.js';
import { SchemaCache } from '../src/services/schema-cache.js';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;
  let mockDiscoveryClient: DiscoveryApiClient;
  let mockSchemaCache: SchemaCache;

  const mockSchema: DiscoverySchema = {
    id: 'sheets:v4',
    name: 'sheets',
    version: 'v4',
    title: 'Google Sheets API',
    description: 'Test',
    documentationLink: 'https://example.com',
    schemas: {
      Spreadsheet: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
          properties: { $ref: 'SpreadsheetProperties' },
        },
      },
    },
    resources: {
      spreadsheets: {
        methods: {
          get: {
            id: 'sheets.spreadsheets.get',
            path: '/v4/spreadsheets/{spreadsheetId}',
            httpMethod: 'GET',
          },
        },
      },
    },
  };

  beforeEach(() => {
    mockDiscoveryClient = new DiscoveryApiClient({ enabled: false });
    mockSchemaCache = new SchemaCache({ cacheDir: '.test-schema-cache' });

    validator = new SchemaValidator({
      discoveryClient: mockDiscoveryClient,
      schemaCache: mockSchemaCache,
    });
  });

  afterEach(() => {
    resetSchemaValidator();
  });

  describe('validateAgainstCurrent', () => {
    it('should return info when Discovery API is disabled', async () => {
      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.severity).toBe('info');
      expect(result.recommendation).toContain('Enable Discovery API');
    });

    it('should validate schema successfully', async () => {
      vi.spyOn(mockSchemaCache, 'get').mockResolvedValue(mockSchema);

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true);
      expect(result.issues.every((issue) => issue.severity !== 'critical')).toBe(true);
    });

    it('should detect missing schemas', async () => {
      const emptySchema: DiscoverySchema = {
        ...mockSchema,
        schemas: {},
        resources: {},
      };

      vi.spyOn(mockSchemaCache, 'get').mockResolvedValue(emptySchema);

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(true); // No critical issues
      expect(result.issues.some((issue) => issue.type === 'missing_method')).toBe(true);
    });

    it('should detect deprecated schemas', async () => {
      const deprecatedSchema: DiscoverySchema = {
        ...mockSchema,
        schemas: {
          OldType: {
            type: 'object',
            deprecated: true,
          },
        },
      };

      vi.spyOn(mockSchemaCache, 'get').mockResolvedValue(deprecatedSchema);

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.issues.some((issue) => issue.type === 'deprecation')).toBe(true);
    });

    it('should handle validation errors', async () => {
      vi.spyOn(mockSchemaCache, 'get').mockRejectedValue(new Error('Network error'));

      const result = await validator.validateAgainstCurrent('sheets');

      expect(result.valid).toBe(false);
      expect(result.issues[0]?.severity).toBe('critical');
      expect(result.issues[0]?.message).toContain('Failed to validate schema');
    });
  });

  describe('compareSchemas', () => {
    it('should detect new fields', async () => {
      const currentSchema = mockSchema;
      const newSchema: DiscoverySchema = {
        ...mockSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              spreadsheetId: { type: 'string' },
              properties: { $ref: 'SpreadsheetProperties' },
              newField: { type: 'string', description: 'A new field' },
            },
          },
        },
      };

      const result = await validator.compareSchemas('sheets', currentSchema, newSchema);

      expect(result.valid).toBe(true);
      expect(result.comparison?.newFields.length).toBeGreaterThan(0);
      expect(result.issues.some((issue) => issue.type === 'new_feature')).toBe(true);
    });

    it('should detect deprecated fields', async () => {
      const currentSchema = mockSchema;
      const newSchema: DiscoverySchema = {
        ...mockSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              spreadsheetId: { type: 'string', deprecated: true, description: 'Use id instead' },
            },
          },
        },
      };

      const result = await validator.compareSchemas('sheets', currentSchema, newSchema);

      expect(result.issues.some((issue) => issue.type === 'deprecation')).toBe(true);
      expect(result.issues.some((issue) => issue.severity === 'medium')).toBe(true);
    });

    it('should detect type changes', async () => {
      const currentSchema: DiscoverySchema = {
        ...mockSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              count: { type: 'string' },
            },
          },
        },
      };

      const newSchema: DiscoverySchema = {
        ...mockSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              count: { type: 'integer' },
            },
          },
        },
      };

      const result = await validator.compareSchemas('sheets', currentSchema, newSchema);

      expect(result.issues.some((issue) => issue.type === 'type_change')).toBe(true);
      expect(result.issues.some((issue) => issue.severity === 'high')).toBe(true);
    });

    it('should detect removed methods as critical', async () => {
      const currentSchema: DiscoverySchema = {
        ...mockSchema,
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'sheets.spreadsheets.get',
                path: '/v4/spreadsheets/{spreadsheetId}',
                httpMethod: 'GET',
              },
              delete: {
                id: 'sheets.spreadsheets.delete',
                path: '/v4/spreadsheets/{spreadsheetId}',
                httpMethod: 'DELETE',
              },
            },
          },
        },
      };

      const newSchema: DiscoverySchema = {
        ...mockSchema,
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'sheets.spreadsheets.get',
                path: '/v4/spreadsheets/{spreadsheetId}',
                httpMethod: 'GET',
              },
            },
          },
        },
      };

      const result = await validator.compareSchemas('sheets', currentSchema, newSchema);

      expect(result.valid).toBe(false); // Critical issues make it invalid
      expect(result.issues.some((issue) => issue.type === 'breaking_change')).toBe(true);
      expect(result.issues.some((issue) => issue.severity === 'critical')).toBe(true);
    });

    it('should detect new methods', async () => {
      const currentSchema = mockSchema;
      const newSchema: DiscoverySchema = {
        ...mockSchema,
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'sheets.spreadsheets.get',
                path: '/v4/spreadsheets/{spreadsheetId}',
                httpMethod: 'GET',
              },
              create: {
                id: 'sheets.spreadsheets.create',
                path: '/v4/spreadsheets',
                httpMethod: 'POST',
                description: 'Creates a new spreadsheet',
              },
            },
          },
        },
      };

      const result = await validator.compareSchemas('sheets', currentSchema, newSchema);

      expect(result.comparison?.newMethods.length).toBeGreaterThan(0);
      expect(
        result.issues.some((issue) => issue.type === 'new_feature' && issue.path.includes('create'))
      ).toBe(true);
    });
  });

  describe('generateMigrationPlan', () => {
    it('should generate plan for deprecated fields', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [],
        deprecatedFields: [
          { path: 'Spreadsheet.oldField', deprecationMessage: 'Use newField instead' },
        ],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(true);
      expect(plan.steps.some((step) => step.title.includes('Deprecated'))).toBe(true);
      expect(plan.steps.some((step) => step.priority === 'required')).toBe(true);
    });

    it('should generate plan for type changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [],
        deprecatedFields: [],
        changedFields: [{ path: 'Spreadsheet.count', oldType: 'string', newType: 'integer' }],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(true);
      expect(plan.steps.some((step) => step.title.includes('Field Types'))).toBe(true);
    });

    it('should generate plan for new fields', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'Spreadsheet.newField', type: 'string', description: 'A new field' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(false);
      expect(plan.steps.some((step) => step.title.includes('New Fields'))).toBe(true);
      expect(plan.steps.some((step) => step.priority === 'optional')).toBe(true);
    });

    it('should generate plan for removed methods', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: ['spreadsheets.delete'],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.hasBreakingChanges).toBe(true);
      expect(plan.steps.some((step) => step.title.includes('Deleted Methods'))).toBe(true);
      expect(plan.steps.some((step) => step.priority === 'required')).toBe(true);
    });

    it('should include testing and documentation steps', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'Spreadsheet.newField', type: 'string', description: 'New' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.steps.some((step) => step.category === 'test_update')).toBe(true);
      expect(plan.steps.some((step) => step.category === 'documentation')).toBe(true);
      expect(plan.steps.some((step) => step.category === 'verification')).toBe(true);
    });

    it('should estimate effort correctly', () => {
      const smallChange: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'test', type: 'string', description: 'test' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan1 = validator.generateMigrationPlan(smallChange);
      expect(plan1.estimatedEffort).toBe('low');

      const mediumChange: SchemaComparison = {
        ...smallChange,
        newFields: Array(8).fill({ path: 'test', type: 'string', description: 'test' }),
      };

      const plan2 = validator.generateMigrationPlan(mediumChange);
      expect(plan2.estimatedEffort).toBe('medium');

      const largeChange: SchemaComparison = {
        ...smallChange,
        newFields: Array(20).fill({ path: 'test', type: 'string', description: 'test' }),
      };

      const plan3 = validator.generateMigrationPlan(largeChange);
      expect(plan3.estimatedEffort).toBe('high');
    });

    it('should list affected files', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'test', type: 'string', description: 'test' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.affectedFiles.length).toBeGreaterThan(0);
      expect(plan.affectedFiles.some((file) => file.includes('google-api.ts'))).toBe(true);
    });

    it('should list testing requirements', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [],
        deprecatedFields: [{ path: 'test', deprecationMessage: 'Deprecated' }],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);

      expect(plan.testingRequired.length).toBeGreaterThan(0);
      expect(plan.testingRequired.some((req) => req.includes('full test suite'))).toBe(true);
    });
  });

  describe('formatMigrationReport', () => {
    it('should format migration report', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'Spreadsheet.newField', type: 'string', description: 'New field' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);
      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('# Migration Plan: SHEETS API v4');
      expect(report).toContain('## Overview');
      expect(report).toContain('## Migration Steps');
      expect(report).toContain('## Affected Files');
      expect(report).toContain('## Testing Required');
    });

    it('should mark breaking changes with warning', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: ['spreadsheets.delete'],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);
      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('⚠️ Breaking Changes');
      expect(report).toContain('WARNING');
    });

    it('should mark non-breaking changes', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'test', type: 'string', description: 'test' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);
      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('✅ Non-Breaking');
    });

    it('should include priority emojis', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [],
        deprecatedFields: [{ path: 'test', deprecationMessage: 'Deprecated' }],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);
      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('🔴'); // Required
      expect(report).toContain('🟡'); // Recommended
    });

    it('should include code examples when available', () => {
      const comparison: SchemaComparison = {
        api: 'sheets',
        version: 'v4',
        newFields: [{ path: 'Spreadsheet.newField', type: 'string', description: 'New' }],
        deprecatedFields: [],
        changedFields: [],
        newMethods: [],
        removedMethods: [],
        hasChanges: true,
      };

      const plan = validator.generateMigrationPlan(comparison);
      const report = validator.formatMigrationReport(plan);

      expect(report).toContain('```typescript');
    });
  });

  describe('global instance', () => {
    afterEach(() => {
      resetSchemaValidator();
    });

    it('should create global instance', () => {
      const globalValidator = getSchemaValidator();

      expect(globalValidator).toBeDefined();
    });

    it('should reuse existing global instance', () => {
      const validator1 = getSchemaValidator();
      const validator2 = getSchemaValidator();

      expect(validator1).toBe(validator2);
    });

    it('should reset global instance', () => {
      const validator1 = getSchemaValidator();
      resetSchemaValidator();
      const validator2 = getSchemaValidator();

      expect(validator1).not.toBe(validator2);
    });
  });
});
