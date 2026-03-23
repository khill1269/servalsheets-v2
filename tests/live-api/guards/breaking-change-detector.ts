/**
 * ServalSheets - Breaking Change Detector
 *
 * Detects potential breaking changes in API responses and tool outputs.
 * Compares current responses against stored snapshots/contracts.
 */

import { createHash } from 'crypto';

/**
 * Schema field definition for contract validation
 */
export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'any';
  required: boolean;
  nullable?: boolean;
  itemType?: SchemaField; // For arrays
  fields?: SchemaField[]; // For objects
}

/**
 * API contract definition
 */
export interface ApiContract {
  name: string;
  version: string;
  responseSchema: SchemaField[];
  requiredFields: string[];
  forbiddenFields?: string[];
  examples?: Record<string, unknown>[];
}

/**
 * Breaking change detection result
 */
export interface BreakingChangeResult {
  hasBreakingChanges: boolean;
  changes: BreakingChange[];
  compatible: boolean;
  summary: string;
}

/**
 * Individual breaking change
 */
export interface BreakingChange {
  type:
    | 'MISSING_FIELD'
    | 'TYPE_CHANGE'
    | 'FORBIDDEN_FIELD'
    | 'SCHEMA_MISMATCH'
    | 'STRUCTURE_CHANGE';
  severity: 'error' | 'warning';
  path: string;
  expected?: string;
  actual?: string;
  message: string;
}

/**
 * Snapshot for comparison
 */
export interface ResponseSnapshot {
  contractName: string;
  timestamp: number;
  hash: string;
  data: unknown;
  schema?: SchemaField[];
}

/**
 * Breaking Change Detector class
 */
export class BreakingChangeDetector {
  private contracts: Map<string, ApiContract> = new Map();
  private snapshots: Map<string, ResponseSnapshot[]> = new Map();

  /**
   * Register an API contract
   */
  registerContract(contract: ApiContract): void {
    this.contracts.set(contract.name, contract);
  }

  /**
   * Get a registered contract
   */
  getContract(name: string): ApiContract | undefined {
    return this.contracts.get(name);
  }

  /**
   * Store a response snapshot
   */
  storeSnapshot(contractName: string, data: unknown): ResponseSnapshot {
    const snapshot: ResponseSnapshot = {
      contractName,
      timestamp: Date.now(),
      hash: this.hashData(data),
      data,
      schema: this.inferSchema(data),
    };

    const existing = this.snapshots.get(contractName) ?? [];
    existing.push(snapshot);

    // Keep only last 10 snapshots per contract
    if (existing.length > 10) {
      existing.shift();
    }

    this.snapshots.set(contractName, existing);
    return snapshot;
  }

  /**
   * Check response against contract
   */
  checkContract(contractName: string, response: unknown): BreakingChangeResult {
    const contract = this.contracts.get(contractName);
    if (!contract) {
      return {
        hasBreakingChanges: false,
        changes: [],
        compatible: true,
        summary: `No contract registered for ${contractName}`,
      };
    }

    const changes: BreakingChange[] = [];

    // Check required fields
    for (const fieldPath of contract.requiredFields) {
      if (!this.hasField(response, fieldPath)) {
        changes.push({
          type: 'MISSING_FIELD',
          severity: 'error',
          path: fieldPath,
          message: `Required field "${fieldPath}" is missing from response`,
        });
      }
    }

    // Check forbidden fields
    if (contract.forbiddenFields) {
      for (const fieldPath of contract.forbiddenFields) {
        if (this.hasField(response, fieldPath)) {
          changes.push({
            type: 'FORBIDDEN_FIELD',
            severity: 'warning',
            path: fieldPath,
            message: `Forbidden field "${fieldPath}" is present in response`,
          });
        }
      }
    }

    // Check schema
    if (contract.responseSchema.length > 0) {
      const schemaChanges = this.validateSchema(response, contract.responseSchema, '');
      changes.push(...schemaChanges);
    }

    const hasBreakingChanges = changes.some((c) => c.severity === 'error');
    return {
      hasBreakingChanges,
      changes,
      compatible: !hasBreakingChanges,
      summary: this.generateSummary(changes),
    };
  }

  /**
   * Check response against previous snapshots
   */
  checkAgainstSnapshots(contractName: string, response: unknown): BreakingChangeResult {
    const snapshots = this.snapshots.get(contractName);
    if (!snapshots || snapshots.length === 0) {
      return {
        hasBreakingChanges: false,
        changes: [],
        compatible: true,
        summary: 'No previous snapshots to compare against',
      };
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const changes: BreakingChange[] = [];

    // Compare structure
    const currentSchema = this.inferSchema(response);
    const snapshotSchema = latestSnapshot.schema ?? this.inferSchema(latestSnapshot.data);

    const structureChanges = this.compareSchemas(snapshotSchema, currentSchema, '');
    changes.push(...structureChanges);

    const hasBreakingChanges = changes.some((c) => c.severity === 'error');
    return {
      hasBreakingChanges,
      changes,
      compatible: !hasBreakingChanges,
      summary: this.generateSummary(changes),
    };
  }

  /**
   * Full compatibility check
   */
  checkCompatibility(contractName: string, response: unknown): BreakingChangeResult {
    const contractResult = this.checkContract(contractName, response);
    const snapshotResult = this.checkAgainstSnapshots(contractName, response);

    const allChanges = [...contractResult.changes, ...snapshotResult.changes];
    const hasBreakingChanges = allChanges.some((c) => c.severity === 'error');

    return {
      hasBreakingChanges,
      changes: allChanges,
      compatible: !hasBreakingChanges,
      summary: this.generateSummary(allChanges),
    };
  }

  /**
   * Check if a field exists at the given path
   */
  private hasField(obj: unknown, path: string): boolean {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return false;
      }
      if (typeof current !== 'object') {
        return false;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current !== undefined;
  }

  /**
   * Get field value at path
   */
  private getField(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Validate against schema
   */
  private validateSchema(data: unknown, schema: SchemaField[], basePath: string): BreakingChange[] {
    const changes: BreakingChange[] = [];

    for (const field of schema) {
      const path = basePath ? `${basePath}.${field.name}` : field.name;
      const value = this.getField(data, field.name);

      // Check required
      if (field.required && value === undefined) {
        changes.push({
          type: 'MISSING_FIELD',
          severity: 'error',
          path,
          expected: field.type,
          actual: 'undefined',
          message: `Required field "${path}" is missing`,
        });
        continue;
      }

      // Skip optional undefined fields
      if (value === undefined) {
        continue;
      }

      // Check nullable
      if (value === null) {
        if (!field.nullable) {
          changes.push({
            type: 'TYPE_CHANGE',
            severity: 'error',
            path,
            expected: field.type,
            actual: 'null',
            message: `Field "${path}" is null but not nullable`,
          });
        }
        continue;
      }

      // Check type
      const actualType = this.getType(value);
      if (field.type !== 'any' && actualType !== field.type) {
        changes.push({
          type: 'TYPE_CHANGE',
          severity: 'error',
          path,
          expected: field.type,
          actual: actualType,
          message: `Field "${path}" type changed from ${field.type} to ${actualType}`,
        });
        continue;
      }

      // Recursive check for objects
      if (field.type === 'object' && field.fields) {
        const nestedChanges = this.validateSchema(value, field.fields, path);
        changes.push(...nestedChanges);
      }

      // Check array items
      if (field.type === 'array' && field.itemType && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const itemPath = `${path}[${i}]`;
          const itemType = this.getType(value[i]);

          if (field.itemType.type !== 'any' && itemType !== field.itemType.type) {
            changes.push({
              type: 'TYPE_CHANGE',
              severity: 'warning',
              path: itemPath,
              expected: field.itemType.type,
              actual: itemType,
              message: `Array item at "${itemPath}" has unexpected type`,
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Compare two schemas for structural changes
   */
  private compareSchemas(
    expected: SchemaField[] | undefined,
    actual: SchemaField[] | undefined,
    basePath: string
  ): BreakingChange[] {
    const changes: BreakingChange[] = [];

    if (!expected || !actual) {
      return changes;
    }

    const expectedMap = new Map(expected.map((f) => [f.name, f]));
    const actualMap = new Map(actual.map((f) => [f.name, f]));

    // Check for removed fields
    for (const [name, field] of expectedMap) {
      const path = basePath ? `${basePath}.${name}` : name;

      if (!actualMap.has(name)) {
        changes.push({
          type: 'STRUCTURE_CHANGE',
          severity: field.required ? 'error' : 'warning',
          path,
          expected: field.type,
          actual: 'removed',
          message: `Field "${path}" was removed from response`,
        });
        continue;
      }

      const actualField = actualMap.get(name)!;

      // Check type change
      if (field.type !== actualField.type) {
        changes.push({
          type: 'TYPE_CHANGE',
          severity: 'error',
          path,
          expected: field.type,
          actual: actualField.type,
          message: `Field "${path}" type changed from ${field.type} to ${actualField.type}`,
        });
      }

      // Recursive for objects
      if (field.type === 'object' && actualField.type === 'object') {
        const nestedChanges = this.compareSchemas(field.fields, actualField.fields, path);
        changes.push(...nestedChanges);
      }
    }

    // Check for new fields (usually not breaking, just informational)
    for (const [name] of actualMap) {
      if (!expectedMap.has(name)) {
        const path = basePath ? `${basePath}.${name}` : name;
        changes.push({
          type: 'STRUCTURE_CHANGE',
          severity: 'warning',
          path,
          expected: 'none',
          actual: 'added',
          message: `New field "${path}" added to response`,
        });
      }
    }

    return changes;
  }

  /**
   * Infer schema from data
   */
  private inferSchema(data: unknown, depth: number = 0): SchemaField[] {
    if (depth > 5 || data === null || data === undefined) {
      return [];
    }

    if (typeof data !== 'object') {
      return [];
    }

    if (Array.isArray(data)) {
      return [];
    }

    const fields: SchemaField[] = [];
    const obj = data as Record<string, unknown>;

    for (const [key, value] of Object.entries(obj)) {
      const type = this.getType(value);
      const field: SchemaField = {
        name: key,
        type,
        required: true,
        nullable: value === null,
      };

      if (type === 'object' && value !== null) {
        field.fields = this.inferSchema(value, depth + 1);
      }

      if (type === 'array' && Array.isArray(value) && value.length > 0) {
        const firstItem = value[0];
        field.itemType = {
          name: 'item',
          type: this.getType(firstItem),
          required: true,
        };
      }

      fields.push(field);
    }

    return fields;
  }

  /**
   * Get type of value
   */
  private getType(value: unknown): SchemaField['type'] {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'any';
  }

  /**
   * Hash data for comparison
   */
  private hashData(data: unknown): string {
    const json = JSON.stringify(data, Object.keys(data as object).sort());
    return createHash('sha256').update(json).digest('hex').substring(0, 16);
  }

  /**
   * Generate summary message
   */
  private generateSummary(changes: BreakingChange[]): string {
    if (changes.length === 0) {
      return 'No breaking changes detected.';
    }

    const errors = changes.filter((c) => c.severity === 'error');
    const warnings = changes.filter((c) => c.severity === 'warning');

    const parts: string[] = [];
    if (errors.length > 0) {
      parts.push(`${errors.length} breaking change(s)`);
    }
    if (warnings.length > 0) {
      parts.push(`${warnings.length} warning(s)`);
    }

    return parts.join(', ');
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.contracts.clear();
    this.snapshots.clear();
  }
}

/**
 * Singleton instance
 */
let _instance: BreakingChangeDetector | null = null;

/**
 * Get the singleton detector
 */
export function getBreakingChangeDetector(): BreakingChangeDetector {
  if (!_instance) {
    _instance = new BreakingChangeDetector();
  }
  return _instance;
}

/**
 * Reset the singleton
 */
export function resetBreakingChangeDetector(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

/**
 * Pre-defined contracts for ServalSheets tools
 */
export const SERVAL_CONTRACTS: Record<string, ApiContract> = {
  sheets_data_read: {
    name: 'sheets_data_read',
    version: '1.0.0',
    requiredFields: ['content', 'isError'],
    responseSchema: [
      { name: 'content', type: 'array', required: true },
      { name: 'isError', type: 'boolean', required: true },
    ],
  },
  sheets_data_write: {
    name: 'sheets_data_write',
    version: '1.0.0',
    requiredFields: ['content', 'isError'],
    responseSchema: [
      { name: 'content', type: 'array', required: true },
      { name: 'isError', type: 'boolean', required: true },
    ],
  },
  sheets_core_get: {
    name: 'sheets_core_get',
    version: '1.0.0',
    requiredFields: ['content', 'isError'],
    responseSchema: [
      { name: 'content', type: 'array', required: true },
      { name: 'isError', type: 'boolean', required: true },
    ],
  },
};

/**
 * Register all predefined contracts
 */
export function registerServalContracts(): void {
  const detector = getBreakingChangeDetector();
  for (const contract of Object.values(SERVAL_CONTRACTS)) {
    detector.registerContract(contract);
  }
}
