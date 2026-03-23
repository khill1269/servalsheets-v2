/**
 * ConfirmService
 *
 * @purpose Implements MCP Elicitation (SEP-1036) for user confirmation before destructive/bulk operations
 * @category Quality
 * @usage Use via sheets_confirm tool; AI plans operation, service sends confirmation request, waits for user approval/rejection
 * @dependencies MCP SDK (Elicitation capability)
 * @stateful Yes - maintains pending confirmation requests, approval/rejection stats, timeout timers
 * @singleton Yes - one instance per process to track confirmation state
 *
 * @example
 * const service = new ConfirmService();
 * const plan = { operation: 'delete_rows', rows: 100, impact: 'Will delete 100 rows with 50 formulas' };
 * const approved = await service.request(plan, { riskLevel: 'high', timeout: 30000 });
 * if (approved) executeOperation();
 */
import { getActionAnnotation } from '../schemas/annotations.js';
import { ServiceError } from '../core/errors.js';

/**
 * Risk level for operations
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * A single step in an operation plan
 */
export interface PlanStep {
  /** Step number (1-based) */
  stepNumber: number;
  /** Human-readable description */
  description: string;
  /** Tool to be called */
  tool: string;
  /** Action within the tool */
  action: string;
  /** Risk level of this step */
  risk: RiskLevel;
  /** Estimated API calls */
  estimatedApiCalls?: number;
  /** Whether this step is destructive */
  isDestructive?: boolean;
  /** Whether this step can be undone */
  canUndo?: boolean;
  /** Optional rationale for why the step is needed */
  rationale?: string;
  /** Expected outcome from this step */
  expectedOutcome?: string;
  /** Estimated step duration in seconds */
  estimatedDuration?: number;
  /** Whether this step can be skipped */
  optional?: boolean;
  /** Step dependencies by step number */
  dependsOn?: number[];
}

export interface PlanAlternative {
  description: string;
  reason?: string;
}

/**
 * An operation plan to be confirmed by the user
 */
export interface OperationPlan {
  /** Unique plan ID */
  id: string;
  /** Plan title */
  title: string;
  /** Detailed description */
  description: string;
  /** Steps in the plan */
  steps: PlanStep[];
  /** Overall risk level */
  overallRisk: RiskLevel;
  /** Total estimated API calls */
  totalApiCalls: number;
  /** Estimated execution time in seconds */
  estimatedTime: number;
  /** Whether a snapshot will be created */
  willCreateSnapshot: boolean;
  /** Warnings to display */
  warnings: string[];
  /** Optional plan success criteria */
  successCriteria?: string[];
  /** Optional rollback strategy summary */
  rollbackStrategy?: string;
  /** Alternative approaches considered */
  alternatives?: PlanAlternative[];
}

/**
 * Result of user confirmation
 */
export interface ConfirmationResult {
  /** Whether the user approved */
  approved: boolean;
  /** Action taken: accept, decline, cancel */
  action: 'accept' | 'decline' | 'cancel';
  /** User's modifications (if any) */
  modifications?: string;
  /** Timestamp of confirmation */
  timestamp: number;
}

/**
 * Elicitation request for plan confirmation
 */
export interface ElicitationRequest {
  mode: 'form';
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<
      string,
      { type: string; title?: string; description?: string; default?: unknown }
    >;
    required?: string[];
  };
}

/**
 * Statistics for confirmation service
 */
export interface ConfirmationStats {
  totalConfirmations: number;
  approved: number;
  declined: number;
  cancelled: number;
  approvalRate: number;
  avgResponseTime: number;
}

/**
 * Confirmation Service
 *
 * Handles user confirmation via MCP Elicitation before executing
 * multi-step operations. This follows the correct architectural pattern:
 * - Claude does the planning (it's an LLM, that's what it does)
 * - ServalSheets presents the plan for confirmation via Elicitation
 * - User approves/modifies/rejects
 * - Claude executes the approved plan
 */
class ConfirmationService {
  private stats: ConfirmationStats = {
    totalConfirmations: 0,
    approved: 0,
    declined: 0,
    cancelled: 0,
    approvalRate: 0,
    avgResponseTime: 0,
  };

  private responseTimes: number[] = [];
  private readonly maxResponseTimeHistory = 100;

  /**
   * Format a plan for display in elicitation message
   */
  formatPlanForDisplay(plan: OperationPlan): string {
    const lines: string[] = [`📋 **${plan.title}**`, '', plan.description, '', '### Steps:'];

    for (const step of plan.steps) {
      const riskEmoji = this.getRiskEmoji(step.risk);
      const destructiveNote = step.isDestructive ? ' ⚠️' : '';
      lines.push(`${step.stepNumber}. ${step.description} ${riskEmoji}${destructiveNote}`);
    }

    lines.push('');
    lines.push('### Summary:');
    lines.push(`- **Total steps:** ${plan.steps.length}`);
    lines.push(`- **Estimated API calls:** ${plan.totalApiCalls}`);
    lines.push(`- **Estimated time:** ${plan.estimatedTime}s`);
    lines.push(`- **Overall risk:** ${plan.overallRisk.toUpperCase()}`);

    if (plan.willCreateSnapshot) {
      lines.push(`- **Snapshot:** Will be created before execution`);
    }

    if (plan.warnings.length > 0) {
      lines.push('');
      lines.push('### ⚠️ Warnings:');
      for (const warning of plan.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    if (plan.successCriteria && plan.successCriteria.length > 0) {
      lines.push('');
      lines.push('### Success Criteria:');
      for (const criterion of plan.successCriteria) {
        lines.push(`- ${criterion}`);
      }
    }

    if (plan.rollbackStrategy) {
      lines.push('');
      lines.push('### Rollback Strategy:');
      lines.push(`- ${plan.rollbackStrategy}`);
    }

    if (plan.alternatives && plan.alternatives.length > 0) {
      lines.push('');
      lines.push('### Alternatives Considered:');
      for (const alternative of plan.alternatives) {
        const reason = alternative.reason ? ` (${alternative.reason})` : '';
        lines.push(`- ${alternative.description}${reason}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get emoji for risk level
   */
  private getRiskEmoji(risk: RiskLevel): string {
    switch (risk) {
      case 'low':
        return '🟢';
      case 'medium':
        return '🟡';
      case 'high':
        return '🟠';
      case 'critical':
        return '🔴';
    }
  }

  /**
   * Build elicitation request for plan confirmation
   */
  buildElicitationRequest(plan: OperationPlan): ElicitationRequest {
    return {
      mode: 'form',
      message: this.formatPlanForDisplay(plan),
      requestedSchema: {
        type: 'object',
        properties: {
          approved: {
            type: 'boolean',
            title: 'Execute this plan?',
            description: 'Check to approve and execute the plan',
            default: true,
          },
          modifications: {
            type: 'string',
            title: 'Modifications (optional)',
            description: 'Any changes you would like to make to the plan',
          },
          skipSnapshot: {
            type: 'boolean',
            title: 'Skip snapshot?',
            description:
              'Skip creating a backup snapshot (not recommended for destructive operations)',
            default: false,
          },
        },
        required: ['approved'],
      },
    };
  }

  /**
   * Process elicitation result into confirmation result
   */
  processElicitationResult(
    elicitResult: { action: string; content?: Record<string, unknown> },
    startTime: number
  ): ConfirmationResult {
    const responseTime = Date.now() - startTime;
    this.recordResponseTime(responseTime);

    this.stats.totalConfirmations++;

    let result: ConfirmationResult;

    if (elicitResult.action === 'accept' && elicitResult.content?.['approved']) {
      this.stats.approved++;
      result = {
        approved: true,
        action: 'accept',
        modifications: elicitResult.content?.['modifications'] as string | undefined,
        timestamp: Date.now(),
      };
    } else if (elicitResult.action === 'decline') {
      this.stats.declined++;
      result = {
        approved: false,
        action: 'decline',
        timestamp: Date.now(),
      };
    } else {
      this.stats.cancelled++;
      result = {
        approved: false,
        action: 'cancel',
        timestamp: Date.now(),
      };
    }

    this.updateApprovalRate();
    return result;
  }

  /**
   * Record response time for statistics
   */
  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }
    this.stats.avgResponseTime =
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  /**
   * Update approval rate
   */
  private updateApprovalRate(): void {
    if (this.stats.totalConfirmations > 0) {
      this.stats.approvalRate = (this.stats.approved / this.stats.totalConfirmations) * 100;
    }
  }

  /**
   * Calculate risk level from steps
   */
  calculateOverallRisk(steps: PlanStep[]): RiskLevel {
    const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    let maxRiskIndex = 0;

    for (const step of steps) {
      const stepRiskIndex = riskOrder.indexOf(step.risk);
      if (stepRiskIndex > maxRiskIndex) {
        maxRiskIndex = stepRiskIndex;
      }
    }

    // Escalate if many steps
    if (steps.length > 5 && maxRiskIndex < 2) {
      maxRiskIndex = Math.min(maxRiskIndex + 1, 3);
    }

    // Escalate if many destructive steps
    const destructiveCount = steps.filter((s) => s.isDestructive).length;
    if (destructiveCount > 2 && maxRiskIndex < 3) {
      maxRiskIndex = Math.min(maxRiskIndex + 1, 3);
    }

    return riskOrder[maxRiskIndex] ?? 'medium';
  }

  /**
   * Generate warnings for a plan
   */
  generateWarnings(plan: OperationPlan): string[] {
    const warnings: string[] = [];

    // Check for destructive operations
    const destructiveSteps = plan.steps.filter((s) => s.isDestructive);
    if (destructiveSteps.length > 0) {
      warnings.push(`${destructiveSteps.length} step(s) will modify or delete data`);
    }

    // Check for non-undoable operations
    const nonUndoable = plan.steps.filter((s) => !s.canUndo);
    if (nonUndoable.length > 0) {
      warnings.push(`${nonUndoable.length} step(s) cannot be automatically undone`);
    }

    // Check for high API usage
    if (plan.totalApiCalls > 20) {
      warnings.push(`High API usage: ${plan.totalApiCalls} calls (may impact quota)`);
    }

    // Check for long execution time
    if (plan.estimatedTime > 30) {
      warnings.push(`Long execution time: ~${plan.estimatedTime}s`);
    }

    // Check for critical risk
    if (plan.overallRisk === 'critical') {
      warnings.push('This plan has CRITICAL risk level - review carefully');
    }

    for (const step of plan.steps) {
      const annotation = getActionAnnotation(step.tool, step.action);
      if (!annotation) continue;

      if (annotation.idempotent === false) {
        warnings.push(
          `Step ${step.stepNumber} (${step.tool}.${step.action}) is non-idempotent; retries can duplicate effects`
        );
      }

      if (annotation.batchAlternative && (step.estimatedApiCalls ?? 1) >= 3) {
        warnings.push(
          `Step ${step.stepNumber} can be optimized with ${annotation.batchAlternative}`
        );
      }
    }

    return Array.from(new Set(warnings));
  }

  /**
   * Create a plan from steps (helper for handlers)
   */
  createPlan(
    title: string,
    description: string,
    steps: PlanStep[],
    options: {
      willCreateSnapshot?: boolean;
      additionalWarnings?: string[];
      successCriteria?: string[];
      rollbackStrategy?: string;
      alternatives?: PlanAlternative[];
    } = {}
  ): OperationPlan {
    const id = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const overallRisk = this.calculateOverallRisk(steps);
    const totalApiCalls = steps.reduce((sum, s) => sum + (s.estimatedApiCalls ?? 1), 0);
    const estimatedTime = Math.ceil(totalApiCalls * 0.5); // ~0.5s per API call

    const plan: OperationPlan = {
      id,
      title,
      description,
      steps,
      overallRisk,
      totalApiCalls,
      estimatedTime,
      willCreateSnapshot: options.willCreateSnapshot ?? true,
      warnings: [],
      successCriteria: options.successCriteria,
      rollbackStrategy: options.rollbackStrategy,
      alternatives: options.alternatives,
    };

    plan.warnings = Array.from(
      new Set([...this.generateWarnings(plan), ...(options.additionalWarnings ?? [])])
    );

    return plan;
  }

  /**
   * Get statistics
   */
  getStats(): ConfirmationStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    this.stats = {
      totalConfirmations: 0,
      approved: 0,
      declined: 0,
      cancelled: 0,
      approvalRate: 0,
      avgResponseTime: 0,
    };
    this.responseTimes = [];
  }
}

// Singleton instance
let confirmationService: ConfirmationService | null = null;

/**
 * Get the confirmation service instance
 */
export function getConfirmationService(): ConfirmationService {
  if (!confirmationService) {
    confirmationService = new ConfirmationService();
  }
  return confirmationService;
}

/**
 * Reset the confirmation service (for testing only)
 * @internal
 */
export function resetConfirmationService(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetConfirmationService() can only be called in test environment',
      'INTERNAL_ERROR',
      'ConfirmationService'
    );
  }
  confirmationService = null;
}
