/**
 * ServalSheets - Policy Enforcer
 *
 * Validates intents against safety policies
 * Tighten-up #2: Effect scope guards
 */

import type { Intent } from './intent.js';
import { DESTRUCTIVE_INTENTS } from './intent.js';
import type { ErrorDetail } from '../schemas/shared.js';

export interface PolicyConfig {
  maxCellsPerOperation: number;
  maxRowsPerDelete: number;
  maxColumnsPerDelete: number;
  requireExplicitRangeForDelete: boolean;
  allowBatchDestructive: boolean;
  maxIntentsPerBatch: number;
}

const DEFAULT_POLICY: PolicyConfig = {
  maxCellsPerOperation: 50000,
  maxRowsPerDelete: 10000,
  maxColumnsPerDelete: 100,
  requireExplicitRangeForDelete: true,
  allowBatchDestructive: false,
  maxIntentsPerBatch: 100,
};

export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PolicyViolationError';
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code as ErrorDetail['code'],
      message: this.message,
      details: this.details,
      retryable: false,
    };
  }
}

/**
 * Enforces safety policies on intents
 */
export class PolicyEnforcer {
  private config: PolicyConfig;

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_POLICY, ...config };
  }

  /**
   * Validate all intents against policy
   */
  async validateIntents(intents: Intent[]): Promise<void> {
    // Check batch size
    if (intents.length > this.config.maxIntentsPerBatch) {
      throw new PolicyViolationError(
        `Batch contains ${intents.length} intents, max is ${this.config.maxIntentsPerBatch}`,
        'EFFECT_SCOPE_EXCEEDED',
        { intentCount: intents.length, max: this.config.maxIntentsPerBatch }
      );
    }

    // Check for multiple destructive operations
    const destructiveCount = intents.filter((i) => DESTRUCTIVE_INTENTS.has(i.type)).length;

    if (destructiveCount > 1 && !this.config.allowBatchDestructive) {
      throw new PolicyViolationError(
        `Batch contains ${destructiveCount} destructive operations. Split into separate calls for safety.`,
        'EFFECT_SCOPE_EXCEEDED',
        { destructiveCount }
      );
    }

    // Validate each intent
    for (const intent of intents) {
      await this.validateIntent(intent);
    }
  }

  /**
   * Validate a single intent
   */
  async validateIntent(intent: Intent): Promise<void> {
    // Check estimated cells
    const estimatedCells = intent.metadata.estimatedCells ?? 0;
    if (estimatedCells > this.config.maxCellsPerOperation) {
      throw new PolicyViolationError(
        `Operation would affect ~${estimatedCells} cells, limit is ${this.config.maxCellsPerOperation}`,
        'EFFECT_SCOPE_EXCEEDED',
        { estimatedCells, max: this.config.maxCellsPerOperation }
      );
    }

    // Check delete operations
    if (intent.type === 'DELETE_DIMENSION') {
      await this.validateDeleteDimension(intent);
    }

    // Check for explicit range requirement
    if (
      this.config.requireExplicitRangeForDelete &&
      DESTRUCTIVE_INTENTS.has(intent.type) &&
      !intent.target.range
    ) {
      throw new PolicyViolationError(
        'Destructive operations require an explicit range',
        'EXPLICIT_RANGE_REQUIRED',
        { intentType: intent.type }
      );
    }
  }

  /**
   * Validate delete dimension operations
   */
  private async validateDeleteDimension(intent: Intent): Promise<void> {
    const payload = intent.payload as {
      dimension?: string;
      startIndex?: number;
      endIndex?: number;
    };

    const count = (payload.endIndex ?? 0) - (payload.startIndex ?? 0);

    if (payload.dimension === 'ROWS' && count > this.config.maxRowsPerDelete) {
      throw new PolicyViolationError(
        `Cannot delete ${count} rows, limit is ${this.config.maxRowsPerDelete}`,
        'EFFECT_SCOPE_EXCEEDED',
        { rowCount: count, max: this.config.maxRowsPerDelete }
      );
    }

    if (payload.dimension === 'COLUMNS' && count > this.config.maxColumnsPerDelete) {
      throw new PolicyViolationError(
        `Cannot delete ${count} columns, limit is ${this.config.maxColumnsPerDelete}`,
        'EFFECT_SCOPE_EXCEEDED',
        { columnCount: count, max: this.config.maxColumnsPerDelete }
      );
    }
  }

  /**
   * Update policy configuration
   */
  updateConfig(config: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current policy configuration
   */
  getConfig(): PolicyConfig {
    return { ...this.config };
  }
}
