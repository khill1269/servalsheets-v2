/**
 * ServalSheets - Confirmation Handler
 *
 * Uses MCP Elicitation (SEP-1036) for user confirmation before executing
 * multi-step operations. This follows the correct MCP pattern:
 * - Claude does the planning (it's an LLM)
 * - This handler presents plans for user confirmation via Elicitation
 * - User approves/modifies/rejects
 * - Claude then executes the approved plan
 *
 * @see MCP_PROTOCOL_COMPLETE_REFERENCE.md - Elicitation section
 */

import { ErrorCodes } from './error-codes.js';
import { randomUUID } from 'crypto';
import { unwrapRequest, type HandlerContext } from './base.js';
import {
  getConfirmationService,
  type OperationPlan as ServicePlan,
  type PlanStep as ServiceStep,
} from '../services/confirm-service.js';
import type {
  SheetsConfirmInput,
  SheetsConfirmOutput,
  ConfirmResponse,
  PlanStep,
  ConfirmRequestInput,
  ConfirmWizardStartInput,
  ConfirmWizardStepInput,
  ConfirmWizardCompleteInput,
  WizardStepDef,
  WizardState,
} from '../schemas/confirm.js';
import { getCapabilitiesWithCache } from '../services/capability-cache.js';
import { registerCleanup } from '../utils/resource-cleanup.js';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { applyVerbosityFilter } from './helpers/verbosity-filter.js';
import { logger } from '../utils/logger.js';
import { getRequestContext } from '../utils/request-context.js';

/**
 * Wizard session storage
 */
interface WizardSession {
  wizardId: string;
  title: string;
  description: string;
  steps: WizardStepDef[];
  currentStepIndex: number;
  completedSteps: string[];
  collectedValues: Record<string, unknown>;
  context?: Record<string, unknown>;
  createdAt: number;
}

type ServerElicitInputParams = Parameters<NonNullable<HandlerContext['server']>['elicitInput']>[0];
type ServerElicitFormParams = Extract<ServerElicitInputParams, { requestedSchema: unknown }>;

// In-memory wizard session store (could be upgraded to Redis for production)
const wizardSessions = new Map<string, WizardSession>();

// DoS protection: maximum concurrent wizard sessions
const MAX_WIZARD_SESSIONS = 1000;

// Cleanup old sessions every 5 minutes
const wizardCleanupInterval = setInterval(
  () => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    for (const [id, session] of wizardSessions) {
      if (now - session.createdAt > maxAge) {
        wizardSessions.delete(id);
      }
    }
  },
  5 * 60 * 1000
);

// Phase 1: Register cleanup to prevent memory leak
registerCleanup(
  'ConfirmHandler',
  () => clearInterval(wizardCleanupInterval),
  'wizard-cleanup-interval'
);

export interface ConfirmHandlerOptions {
  context: HandlerContext;
}

function buildElicitationUnavailableError(message: string): {
  code: typeof ErrorCodes.ELICITATION_UNAVAILABLE;
  message: string;
  retryable: false;
  fixableVia: { tool: string; action: string; params: { title: string } };
} {
  return {
    code: ErrorCodes.ELICITATION_UNAVAILABLE,
    message,
    retryable: false,
    fixableVia: {
      tool: 'sheets_confirm',
      action: 'wizard_start',
      params: {
        title: 'Confirm operation',
      },
    },
  } as const;
}

/**
 * Confirmation Handler
 *
 * Handles user confirmation via MCP Elicitation before multi-step operations.
 */
export class ConfirmHandler {
  private context: HandlerContext;

  constructor(options: ConfirmHandlerOptions) {
    this.context = options.context;
  }

  /**
   * Convert schema plan step to service plan step
   */
  private toServiceStep(step: PlanStep): ServiceStep {
    return {
      stepNumber: step.stepNumber,
      description: step.description,
      tool: step.tool,
      action: step.action,
      risk: step.risk,
      estimatedApiCalls: step.estimatedApiCalls,
      isDestructive: step.isDestructive,
      canUndo: step.canUndo,
      rationale: step.rationale,
      expectedOutcome: step.expectedOutcome,
      estimatedDuration: step.estimatedDuration,
      optional: step.optional,
      dependsOn: step.dependsOn,
    };
  }

  /**
   * Handle confirmation requests
   */
  async handle(input: SheetsConfirmInput): Promise<SheetsConfirmOutput> {
    const req = unwrapRequest<SheetsConfirmInput['request']>(
      input
    ) as SheetsConfirmInput['request'] & {
      verbosity?: 'minimal' | 'standard' | 'detailed';
    };
    const verbosity = req.verbosity ?? 'standard';
    const confirmService = getConfirmationService();
    const requestActionLabel = String((req as { action?: unknown }).action ?? 'unknown');

    try {
      let response: ConfirmResponse;

      switch (req.action) {
        case 'request': {
          // Type assertion for flattened union pattern
          const requestInput = req as ConfirmRequestInput;

          // Check if server is available
          if (!this.context.server) {
            response = {
              success: false,
              error: buildElicitationUnavailableError(
                'MCP Server instance not available. Cannot perform elicitation.'
              ),
            };
            break;
          }

          // Check if client supports elicitation (with caching)
          const sessionId = getRequestContext()?.requestId ?? this.context.requestId ?? 'default';
          const clientCapabilities = await getCapabilitiesWithCache(sessionId, this.context.server);
          if (!clientCapabilities?.elicitation) {
            response = {
              success: false,
              error: buildElicitationUnavailableError(
                'MCP Elicitation not available. The MCP client must declare elicitation capability during initialize (SEP-1036). Claude Desktop does not yet support this. Use sheets_confirm.wizard_start for multi-step confirmation flows as an alternative, or use the HTTP transport with an elicitation-capable client.'
              ),
            };
            break;
          }

          // Convert input plan to service plan
          const plan: ServicePlan = confirmService.createPlan(
            requestInput.plan.title,
            requestInput.plan.description,
            requestInput.plan.steps.map(this.toServiceStep),
            {
              willCreateSnapshot: requestInput.plan.willCreateSnapshot,
              additionalWarnings: requestInput.plan.additionalWarnings,
              successCriteria: requestInput.plan.successCriteria,
              rollbackStrategy: requestInput.plan.rollbackStrategy,
              alternatives: requestInput.plan.alternatives,
            }
          );

          // Build elicitation request
          const elicitRequest = confirmService.buildElicitationRequest(plan);

          // Request user confirmation via MCP Elicitation
          const startTime = Date.now();
          const elicitResult = await this.context.server.elicitInput({
            mode: 'form',
            message: elicitRequest.message,
            // Cast through the SDK's form-elicitation param type to align JSON-schema shapes.
            requestedSchema:
              elicitRequest.requestedSchema as ServerElicitFormParams['requestedSchema'],
          });

          // Process result (convert ElicitResult to the format expected by service)
          const confirmation = confirmService.processElicitationResult(
            {
              action: elicitResult.action,
              content: elicitResult.content,
            },
            startTime
          );

          response = {
            success: true,
            action: 'request',
            planId: plan.id,
            confirmation: {
              approved: confirmation.approved,
              action: confirmation.action,
              modifications: confirmation.modifications,
              timestamp: confirmation.timestamp,
            },
            message: confirmation.approved
              ? `Plan "${plan.title}" approved by user. Ready for execution.`
              : `Plan "${plan.title}" ${confirmation.action === 'decline' ? 'declined' : 'cancelled'} by user.`,
          };
          break;
        }

        case 'get_stats': {
          const stats = confirmService.getStats();
          response = {
            success: true,
            action: 'get_stats',
            stats: {
              totalConfirmations: stats.totalConfirmations,
              approved: stats.approved,
              declined: stats.declined,
              cancelled: stats.cancelled,
              approvalRate: stats.approvalRate,
              avgResponseTime: stats.avgResponseTime,
            },
            message: `${stats.totalConfirmations} confirmations, ${stats.approvalRate.toFixed(1)}% approval rate`,
          };
          break;
        }

        case 'wizard_start': {
          const wizardInput = req as ConfirmWizardStartInput;
          const wizardId = wizardInput.wizardId || `wiz_${randomUUID()}`;

          // DoS protection: evict oldest session if at capacity
          if (wizardSessions.size >= MAX_WIZARD_SESSIONS) {
            let oldest: [string, WizardSession] | undefined;
            for (const entry of wizardSessions) {
              if (!oldest || entry[1].createdAt < oldest[1].createdAt) {
                oldest = entry;
              }
            }
            if (oldest) {
              wizardSessions.delete(oldest[0]);
              logger.warn('Evicted oldest wizard session due to capacity limit', {
                evictedId: oldest[0],
                capacity: MAX_WIZARD_SESSIONS,
              });
            }
          }

          // Create wizard session
          const session: WizardSession = {
            wizardId,
            title: wizardInput.title,
            description: wizardInput.description,
            steps: wizardInput.steps,
            currentStepIndex: 0,
            completedSteps: [],
            collectedValues: {},
            context: wizardInput.context,
            createdAt: Date.now(),
          };

          wizardSessions.set(wizardId, session);

          const firstStep = session.steps[0]!;
          const wizardState: WizardState = {
            wizardId,
            title: session.title,
            currentStepIndex: 0,
            totalSteps: session.steps.length,
            currentStepId: firstStep.stepId,
            completedSteps: [],
            collectedValues: {},
            isComplete: false,
          };

          response = {
            success: true,
            action: 'wizard_start',
            wizard: wizardState,
            nextStep: firstStep,
            message: `Wizard "${session.title}" started. Step 1 of ${session.steps.length}: ${firstStep.title}`,
          };
          break;
        }

        case 'wizard_step': {
          const stepInput = req as ConfirmWizardStepInput;
          const session = wizardSessions.get(stepInput.wizardId);

          if (!session) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.NOT_FOUND,
                message: `Wizard "${stepInput.wizardId}" not found. It may have expired.`,
                retryable: false,
                suggestedFix: 'Verify the spreadsheet ID is correct and the spreadsheet exists',
              },
            };
            break;
          }

          // Validate step ID
          const stepIndex = session.steps.findIndex((s) => s.stepId === stepInput.stepId);
          if (stepIndex === -1) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.INVALID_PARAMS,
                message: `Step "${stepInput.stepId}" not found in wizard.`,
                retryable: false,
                suggestedFix:
                  "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
              },
            };
            break;
          }

          // Handle navigation
          let nextIndex: number;
          if (stepInput.direction === 'back') {
            nextIndex = Math.max(0, session.currentStepIndex - 1);
          } else if (stepInput.direction === 'skip') {
            nextIndex = Math.min(session.steps.length - 1, session.currentStepIndex + 1);
          } else {
            // 'next' - store values and advance
            session.collectedValues = {
              ...session.collectedValues,
              [stepInput.stepId]: stepInput.values,
            };
            if (!session.completedSteps.includes(stepInput.stepId)) {
              session.completedSteps.push(stepInput.stepId);
            }
            nextIndex = Math.min(session.steps.length - 1, session.currentStepIndex + 1);
          }

          session.currentStepIndex = nextIndex;
          const isComplete = session.completedSteps.length === session.steps.length;

          const currentStep = session.steps[nextIndex]!;
          const wizardState: WizardState = {
            wizardId: session.wizardId,
            title: session.title,
            currentStepIndex: nextIndex,
            totalSteps: session.steps.length,
            currentStepId: currentStep.stepId,
            completedSteps: session.completedSteps,
            collectedValues: session.collectedValues as Record<
              string,
              string | number | boolean | unknown[] | Record<string, unknown> | null
            >,
            isComplete,
          };

          response = {
            success: true,
            action: 'wizard_step',
            wizard: wizardState,
            nextStep: isComplete ? undefined : currentStep,
            message: isComplete
              ? `Wizard complete. All ${session.steps.length} steps collected.`
              : `Step ${nextIndex + 1} of ${session.steps.length}: ${currentStep.title}`,
          };
          break;
        }

        case 'wizard_complete': {
          const completeInput = req as ConfirmWizardCompleteInput;
          const session = wizardSessions.get(completeInput.wizardId);

          if (!session) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.NOT_FOUND,
                message: `Wizard "${completeInput.wizardId}" not found. It may have expired.`,
                retryable: false,
                suggestedFix: 'Verify the spreadsheet ID is correct and the spreadsheet exists',
              },
            };
            break;
          }

          // Return final state
          const finalState: WizardState = {
            wizardId: session.wizardId,
            title: session.title,
            currentStepIndex: session.steps.length - 1,
            totalSteps: session.steps.length,
            currentStepId: session.steps[session.steps.length - 1]!.stepId,
            completedSteps: session.completedSteps,
            collectedValues: session.collectedValues as Record<
              string,
              string | number | boolean | unknown[] | Record<string, unknown> | null
            >,
            isComplete: true,
          };

          // Clean up session
          wizardSessions.delete(completeInput.wizardId);

          response = {
            success: true,
            action: 'wizard_complete',
            wizard: finalState,
            message: `Wizard "${session.title}" completed with ${Object.keys(session.collectedValues).length} steps of data.`,
          };
          break;
        }

        default: {
          // Exhaustiveness guard: compile error if a new ConfirmActionSchema action is added
          // without a corresponding case here.
          const _exhaustiveCheck: never = req as never;
          void _exhaustiveCheck;
          response = {
            success: false,
            error: {
              code: ErrorCodes.INVALID_PARAMS,
              message: `Unknown action: ${requestActionLabel}`,
              retryable: false,
            },
          };
          break;
        }
      }

      // Apply verbosity filtering (LLM optimization)
      return { response: applyVerbosityFilter(response, verbosity) };
    } catch (error) {
      logger.error('Confirm handler error', {
        action: req.action,
        error,
      });
      return {
        response: {
          success: false,
          error: mapStandaloneError(error),
        },
      };
    }
  }
}
