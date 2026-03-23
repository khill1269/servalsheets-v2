/**
 * Schema Migration Utilities
 */

import { logger } from '../utils/logger.js';
import type { SchemaVersion } from './schema-manager.js';
import { transformRequestV1ToV2, isActionDeprecated, getV2ActionName } from './v1-compat.js';

export interface MigrationResult {
  success: boolean;
  originalVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  transformedData: Record<string, unknown>;
  warnings: string[];
  errors?: string[];
}

export interface MigrationWarning {
  field: string;
  message: string;
  suggestion: string;
}

export type MigrationStrategy = 'strict' | 'lenient' | 'auto';

export class SchemaMigrator {
  constructor(_strategy: MigrationStrategy = 'auto') {
    // _strategy reserved for future strict/lenient migration mode enforcement
  }

  migrateRequestV1ToV2(request: Record<string, unknown>): MigrationResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    const action = request['action'] as string | undefined;
    if (action && isActionDeprecated(action)) {
      const v2Action = getV2ActionName(action);
      warnings.push(`Action '${action}' is deprecated. Migrated to '${v2Action}'.`);
    }

    let transformedData: Record<string, unknown>;
    try {
      transformedData = transformRequestV1ToV2(request);
    } catch (error) {
      errors.push(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        originalVersion: 'v1',
        targetVersion: 'v2',
        transformedData: request,
        warnings,
        errors,
      };
    }

    logger.info('Migrated request v1 → v2', { action, warningCount: warnings.length });

    return {
      success: errors.length === 0,
      originalVersion: 'v1',
      targetVersion: 'v2',
      transformedData,
      warnings,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  getMigrationWarnings(
    request: Record<string, unknown>,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion
  ): MigrationWarning[] {
    const warnings: MigrationWarning[] = [];

    if (fromVersion === 'v1' && toVersion === 'v2') {
      const action = request['action'] as string | undefined;
      if (action && isActionDeprecated(action)) {
        warnings.push({
          field: 'action',
          message: `Action '${action}' is deprecated in v2`,
          suggestion: `Use '${getV2ActionName(action)}' instead`,
        });
      }

      if ('newName' in request) {
        warnings.push({
          field: 'newName',
          message: "Field 'newName' renamed to 'title' in v2",
          suggestion: "Replace 'newName' with 'title'",
        });
      }
    }

    return warnings;
  }

  generateMigrationScript(
    requests: Array<Record<string, unknown>>,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion
  ): string {
    const script: string[] = [
      `# Schema Migration Script: ${fromVersion} → ${toVersion}`,
      `# Generated: ${new Date().toISOString()}`,
      `# Total requests: ${requests.length}`,
      '',
    ];

    const actionChanges = new Map<string, string>();
    for (const request of requests) {
      const action = request['action'] as string | undefined;
      if (action && isActionDeprecated(action)) {
        actionChanges.set(action, getV2ActionName(action));
      }
    }

    if (actionChanges.size > 0) {
      script.push('# Action renames:');
      for (const [old, updated] of actionChanges.entries()) {
        script.push(`#   ${old} → ${updated}`);
      }
    }

    return script.join('\n');
  }
}

export const schemaMigrator = new SchemaMigrator('auto');

export function migrateRequest(
  request: Record<string, unknown>,
  fromVersion: SchemaVersion,
  toVersion: SchemaVersion
): MigrationResult {
  if (fromVersion === 'v1' && toVersion === 'v2') {
    return schemaMigrator.migrateRequestV1ToV2(request);
  }

  return {
    success: true,
    originalVersion: fromVersion,
    targetVersion: toVersion,
    transformedData: request,
    warnings: [],
  };
}
