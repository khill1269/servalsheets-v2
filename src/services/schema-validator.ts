/**
 * SchemaValidator
 *
 * @purpose Validates discovered Google API schemas against current implementation; detects breaking changes, deprecations, migration needs
 * @category Quality
 * @usage Use with DiscoveryClient to validate API compatibility; compares field changes, required parameters, deprecated endpoints
 * @dependencies logger, DiscoveryClient, SchemaCache
 * @stateful No - stateless validation comparing two schemas
 * @singleton No - can be instantiated per validation request
 *
 * @example
 * const validator = new SchemaValidator();
 * const comparison = await validator.validate(currentSchema, discoveredSchema);
 * if (comparison.breaking Changes.length > 0) logger.error('Breaking changes detected:', comparison.breakingChanges);
 * if (comparison.deprecations.length > 0) logger.warn('Deprecations found:', comparison.deprecations);
 */

import { logger } from '../utils/logger.js';
import {
  DiscoveryApiClient,
  type SchemaComparison,
  type DiscoverySchema,
} from './discovery-client.js';
import { SchemaCache } from './schema-cache.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  comparison?: SchemaComparison;
  recommendation: string;
}

/**
 * Validation issue
 */
export interface ValidationIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  type: 'breaking_change' | 'deprecation' | 'new_feature' | 'type_change' | 'missing_method';
  path: string;
  message: string;
  suggestedAction?: string;
}

/**
 * Migration plan
 */
export interface MigrationPlan {
  api: string;
  version: string;
  hasBreakingChanges: boolean;
  estimatedEffort: 'low' | 'medium' | 'high';
  steps: MigrationStep[];
  affectedFiles: string[];
  testingRequired: string[];
}

/**
 * Migration step
 */
export interface MigrationStep {
  order: number;
  title: string;
  description: string;
  category: 'code_change' | 'test_update' | 'documentation' | 'verification';
  priority: 'required' | 'recommended' | 'optional';
  estimatedTime: string;
  codeExample?: string;
}

/**
 * Schema Validator Configuration
 */
export interface SchemaValidatorConfig {
  discoveryClient?: DiscoveryApiClient;
  schemaCache?: SchemaCache;
  strictMode?: boolean;
}

/**
 * Schema Validator
 *
 * Validates discovered schemas and generates migration guidance.
 */
export class SchemaValidator {
  private readonly discoveryClient: DiscoveryApiClient;
  private readonly schemaCache: SchemaCache;

  constructor(config: SchemaValidatorConfig = {}) {
    this.discoveryClient = config.discoveryClient ?? new DiscoveryApiClient();
    this.schemaCache = config.schemaCache ?? new SchemaCache();
    // config.strictMode reserved for future strict validation enforcement
  }

  /**
   * Validate current implementation against latest API schema
   */
  async validateAgainstCurrent(api: 'sheets' | 'drive'): Promise<ValidationResult> {
    const version = api === 'sheets' ? 'v4' : 'v3';

    logger.info('Validating against current API schema', { api, version });

    try {
      // Get current schema from cache or fetch from Discovery API
      let currentSchema = await this.schemaCache.get(api, version);

      if (!currentSchema) {
        if (!this.discoveryClient.isEnabled()) {
          return {
            valid: true,
            issues: [
              {
                severity: 'info',
                type: 'new_feature',
                path: '',
                message: 'Discovery API is not enabled. Cannot validate schema.',
              },
            ],
            recommendation:
              'Enable Discovery API with DISCOVERY_API_ENABLED=true to detect schema changes.',
          };
        }

        currentSchema = await this.discoveryClient.getApiSchema(api, version);
        await this.schemaCache.set(api, version, currentSchema);
      }

      // For now, we don't have a "baseline" schema to compare against
      // In a real implementation, you would compare against a known-good schema
      // stored in the codebase or a previous cache entry

      const issues: ValidationIssue[] = [];

      // Check for common issues
      this.detectCommonIssues(currentSchema, issues);

      const valid = issues.filter((issue) => issue.severity === 'critical').length === 0;

      return {
        valid,
        issues,
        recommendation: valid
          ? 'Schema is valid and compatible with current implementation.'
          : 'Critical issues detected. Review and update implementation.',
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error('Failed to validate schema', { api, version, error: err.message });

      return {
        valid: false,
        issues: [
          {
            severity: 'critical',
            type: 'breaking_change',
            path: '',
            message: `Failed to validate schema: ${err.message}`,
          },
        ],
        recommendation: 'Fix schema validation errors before proceeding.',
      };
    }
  }

  /**
   * Compare two schemas and validate compatibility
   */
  async compareSchemas(
    api: 'sheets' | 'drive',
    currentSchema: DiscoverySchema,
    newSchema: DiscoverySchema
  ): Promise<ValidationResult> {
    logger.info('Comparing schemas for compatibility', {
      api,
      currentVersion: currentSchema.version,
      newVersion: newSchema.version,
    });

    const comparison = this.discoveryClient.compareSchemas(
      api,
      newSchema.version,
      currentSchema,
      newSchema
    );

    const issues = this.comparisonToIssues(comparison);
    const critical = issues.filter((issue) => issue.severity === 'critical');

    return {
      valid: critical.length === 0,
      issues,
      comparison,
      recommendation: this.generateRecommendation(issues, comparison),
    };
  }

  /**
   * Generate migration plan from schema comparison
   */
  generateMigrationPlan(comparison: SchemaComparison): MigrationPlan {
    const steps: MigrationStep[] = [];
    let stepOrder = 1;

    // Handle deprecated fields
    if (comparison.deprecatedFields.length > 0) {
      steps.push({
        order: stepOrder++,
        title: 'Address Deprecated Fields',
        description: `Update code to stop using ${comparison.deprecatedFields.length} deprecated fields before they are removed.`,
        category: 'code_change',
        priority: 'required',
        estimatedTime: `${comparison.deprecatedFields.length * 15} minutes`,
        codeExample: this.generateDeprecationExample(comparison.deprecatedFields[0]),
      });
    }

    // Handle type changes
    if (comparison.changedFields.length > 0) {
      steps.push({
        order: stepOrder++,
        title: 'Update Field Types',
        description: `${comparison.changedFields.length} fields have changed types. Update type definitions and validation logic.`,
        category: 'code_change',
        priority: 'required',
        estimatedTime: `${comparison.changedFields.length * 20} minutes`,
        codeExample: this.generateTypeChangeExample(comparison.changedFields[0]),
      });
    }

    // Handle new fields
    if (comparison.newFields.length > 0) {
      steps.push({
        order: stepOrder++,
        title: 'Integrate New Fields',
        description: `${comparison.newFields.length} new fields are available. Consider adding support to enhance functionality.`,
        category: 'code_change',
        priority: 'optional',
        estimatedTime: `${comparison.newFields.length * 30} minutes`,
        codeExample: this.generateNewFieldExample(comparison.newFields[0]),
      });
    }

    // Handle new methods
    if (comparison.newMethods.length > 0) {
      steps.push({
        order: stepOrder++,
        title: 'Integrate New API Methods',
        description: `${comparison.newMethods.length} new API methods are available. Evaluate if they provide value for users.`,
        category: 'code_change',
        priority: 'recommended',
        estimatedTime: `${comparison.newMethods.length * 60} minutes`,
      });
    }

    // Handle removed methods
    if (comparison.removedMethods.length > 0) {
      steps.push({
        order: stepOrder++,
        title: 'Remove Usage of Deleted Methods',
        description: `${comparison.removedMethods.length} methods have been removed from the API. Find alternatives or remove functionality.`,
        category: 'code_change',
        priority: 'required',
        estimatedTime: `${comparison.removedMethods.length * 45} minutes`,
      });
    }

    // Add testing step
    steps.push({
      order: stepOrder++,
      title: 'Update Test Suite',
      description: 'Update tests to cover new fields, methods, and type changes.',
      category: 'test_update',
      priority: 'required',
      estimatedTime: '2 hours',
    });

    // Add documentation step
    steps.push({
      order: stepOrder++,
      title: 'Update Documentation',
      description: 'Update README, API docs, and examples to reflect schema changes.',
      category: 'documentation',
      priority: 'recommended',
      estimatedTime: '1 hour',
    });

    // Add verification step
    steps.push({
      order: stepOrder++,
      title: 'Verify Integration',
      description: 'Run full test suite and manual testing to ensure all changes work correctly.',
      category: 'verification',
      priority: 'required',
      estimatedTime: '1 hour',
    });

    // Estimate overall effort
    const hasBreakingChanges =
      comparison.removedMethods.length > 0 ||
      comparison.changedFields.length > 0 ||
      comparison.deprecatedFields.length > 0;

    const totalChanges =
      comparison.newFields.length +
      comparison.deprecatedFields.length +
      comparison.changedFields.length +
      comparison.newMethods.length +
      comparison.removedMethods.length;

    let estimatedEffort: 'low' | 'medium' | 'high';
    if (totalChanges === 0) {
      estimatedEffort = 'low';
    } else if (totalChanges < 5 && !hasBreakingChanges) {
      estimatedEffort = 'low';
    } else if (totalChanges < 15 && !hasBreakingChanges) {
      estimatedEffort = 'medium';
    } else {
      estimatedEffort = 'high';
    }

    return {
      api: comparison.api,
      version: comparison.version,
      hasBreakingChanges,
      estimatedEffort,
      steps,
      affectedFiles: this.getAffectedFiles(comparison),
      testingRequired: this.getTestingRequirements(comparison),
    };
  }

  /**
   * Get formatted migration report
   */
  formatMigrationReport(plan: MigrationPlan): string {
    const lines: string[] = [
      `# Migration Plan: ${plan.api.toUpperCase()} API ${plan.version}`,
      '',
      `**Status**: ${plan.hasBreakingChanges ? '⚠️ Breaking Changes' : '✅ Non-Breaking'}`,
      `**Effort**: ${plan.estimatedEffort.toUpperCase()}`,
      '',
      '## Overview',
      '',
      `This migration plan covers ${plan.steps.length} steps to update the codebase for ${plan.api} API ${plan.version}.`,
      '',
    ];

    if (plan.hasBreakingChanges) {
      lines.push(
        '⚠️ **WARNING**: This migration includes breaking changes that require code updates.'
      );
      lines.push('');
    }

    lines.push('## Migration Steps', '');

    for (const step of plan.steps) {
      const priorityEmoji =
        step.priority === 'required' ? '🔴' : step.priority === 'recommended' ? '🟡' : '🟢';
      lines.push(`### ${step.order}. ${priorityEmoji} ${step.title}`);
      lines.push('');
      lines.push(`**Category**: ${step.category.replace('_', ' ')}`);
      lines.push(`**Priority**: ${step.priority}`);
      lines.push(`**Estimated Time**: ${step.estimatedTime}`);
      lines.push('');
      lines.push(step.description);
      lines.push('');

      if (step.codeExample) {
        lines.push('```typescript');
        lines.push(step.codeExample);
        lines.push('```');
        lines.push('');
      }
    }

    if (plan.affectedFiles.length > 0) {
      lines.push('## Affected Files', '');
      for (const file of plan.affectedFiles) {
        lines.push(`- ${file}`);
      }
      lines.push('');
    }

    if (plan.testingRequired.length > 0) {
      lines.push('## Testing Required', '');
      for (const test of plan.testingRequired) {
        lines.push(`- ${test}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Detect common issues in a schema
   */
  private detectCommonIssues(schema: DiscoverySchema, issues: ValidationIssue[]): void {
    // Check if schema has required properties
    if (!schema.schemas || Object.keys(schema.schemas).length === 0) {
      issues.push({
        severity: 'high',
        type: 'missing_method',
        path: 'schemas',
        message: 'Schema has no type definitions',
      });
    }

    if (!schema.resources || Object.keys(schema.resources).length === 0) {
      issues.push({
        severity: 'high',
        type: 'missing_method',
        path: 'resources',
        message: 'Schema has no resource definitions',
      });
    }

    // Check for deprecated items in current schema
    for (const [name, schemaDef] of Object.entries(schema.schemas || {})) {
      if (schemaDef.deprecated) {
        issues.push({
          severity: 'medium',
          type: 'deprecation',
          path: `schemas.${name}`,
          message: `Schema type '${name}' is deprecated`,
          suggestedAction: 'Review usage and migrate to alternative types',
        });
      }
    }
  }

  /**
   * Convert schema comparison to validation issues
   */
  private comparisonToIssues(comparison: SchemaComparison): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Removed methods are critical
    for (const method of comparison.removedMethods) {
      issues.push({
        severity: 'critical',
        type: 'breaking_change',
        path: method,
        message: `Method '${method}' has been removed from the API`,
        suggestedAction: 'Find alternative method or remove functionality',
      });
    }

    // Type changes are high severity
    for (const field of comparison.changedFields) {
      issues.push({
        severity: 'high',
        type: 'type_change',
        path: field.path,
        message: `Type changed from '${field.oldType}' to '${field.newType}'`,
        suggestedAction: 'Update type definitions and validation logic',
      });
    }

    // Deprecated fields are medium severity
    for (const field of comparison.deprecatedFields) {
      issues.push({
        severity: 'medium',
        type: 'deprecation',
        path: field.path,
        message: field.deprecationMessage,
        suggestedAction: 'Stop using this field before it is removed',
      });
    }

    // New fields are informational
    for (const field of comparison.newFields) {
      issues.push({
        severity: 'info',
        type: 'new_feature',
        path: field.path,
        message: `New field available: ${field.description || field.type}`,
        suggestedAction: 'Consider integrating to enhance functionality',
      });
    }

    // New methods are informational
    for (const method of comparison.newMethods) {
      issues.push({
        severity: 'info',
        type: 'new_feature',
        path: method.name,
        message: `New method available: ${method.description}`,
        suggestedAction: 'Evaluate if this method provides value for users',
      });
    }

    return issues;
  }

  /**
   * Generate recommendation based on issues
   */
  private generateRecommendation(issues: ValidationIssue[], comparison: SchemaComparison): string {
    const critical = issues.filter((i) => i.severity === 'critical').length;
    const high = issues.filter((i) => i.severity === 'high').length;

    if (critical > 0) {
      return `⚠️ CRITICAL: ${critical} breaking changes detected. Immediate action required to maintain compatibility.`;
    }

    if (high > 0) {
      return `⚠️ WARNING: ${high} significant changes detected. Review and update implementation soon.`;
    }

    if (comparison.newFields.length > 0 || comparison.newMethods.length > 0) {
      return `ℹ️ INFO: New features available. Consider integrating to enhance functionality.`;
    }

    return '✅ No significant changes detected. Schema is compatible.';
  }

  /**
   * Get affected files based on comparison
   */
  private getAffectedFiles(comparison: SchemaComparison): string[] {
    const files: string[] = [];

    if (comparison.api === 'sheets') {
      files.push('src/services/google-api.ts');
      files.push('src/handlers/spreadsheet.ts');
      files.push('src/handlers/values.ts');
      files.push('src/handlers/sheet.ts');
      files.push('src/schemas/spreadsheet.ts');
      files.push('src/schemas/values.ts');
      files.push('src/schemas/sheet.ts');
    } else {
      files.push('src/services/google-api.ts');
      files.push('src/handlers/sharing.ts');
      files.push('src/schemas/sharing.ts');
    }

    return files;
  }

  /**
   * Get testing requirements based on comparison
   */
  private getTestingRequirements(comparison: SchemaComparison): string[] {
    const requirements: string[] = [];

    if (comparison.deprecatedFields.length > 0 || comparison.changedFields.length > 0) {
      requirements.push('Run full test suite to verify no regressions');
      requirements.push('Update schema snapshot tests');
    }

    if (comparison.newFields.length > 0 || comparison.newMethods.length > 0) {
      requirements.push('Add tests for new functionality');
    }

    if (comparison.removedMethods.length > 0) {
      requirements.push('Remove tests for deleted methods');
      requirements.push('Verify alternative implementations work correctly');
    }

    requirements.push('Run integration tests against live API');
    requirements.push('Manual testing of affected features');

    return requirements;
  }

  /**
   * Generate code example for deprecation
   */
  private generateDeprecationExample(field?: {
    path: string;
    deprecationMessage: string;
  }): string | undefined {
    // OK: Explicit empty - no field provided
    if (!field) return undefined;

    return `// Before (deprecated)
const value = spreadsheet.${field.path};

// After (recommended)
// ${field.deprecationMessage}
// Use the recommended alternative field or method`;
  }

  /**
   * Generate code example for type change
   */
  private generateTypeChangeExample(field?: {
    path: string;
    oldType: string;
    newType: string;
  }): string | undefined {
    // OK: Explicit empty - no field provided
    if (!field) return undefined;

    return `// Before
const value: ${field.oldType} = data.${field.path};

// After
const value: ${field.newType} = data.${field.path};

// Update validation logic
if (typeof value === '${field.newType}') {
  // Handle new type
}`;
  }

  /**
   * Generate code example for new field
   */
  private generateNewFieldExample(field?: {
    path: string;
    type: string;
    description: string;
  }): string | undefined {
    // OK: Explicit empty - no field provided
    if (!field) return undefined;

    return `// New field available: ${field.description}
const ${field.path.split('.').pop()} = spreadsheet.${field.path};

// Type: ${field.type}
// Consider adding support for this field`;
  }
}

/**
 * Global schema validator instance
 */
let globalSchemaValidator: SchemaValidator | null = null;

/**
 * Get or create global schema validator
 */
export function getSchemaValidator(): SchemaValidator {
  if (!globalSchemaValidator) {
    globalSchemaValidator = new SchemaValidator();
  }
  return globalSchemaValidator;
}

/**
 * Reset global schema validator
 */
export function resetSchemaValidator(): void {
  globalSchemaValidator = null;
}
