import { ErrorCodes } from './error-codes.js';
import { assertNever } from '../utils/type-utils.js';
import type { SheetsAgentInput, SheetsAgentOutput } from '../schemas/agent.js';
import { HandlerLoadError } from '../core/errors.js';
import {
  compilePlanAI,
  executePlan,
  executeStep,
  createCheckpoint,
  rollbackToPlan,
  getPlanStatus,
  listPlans,
  resumePlan,
  type ExecuteHandlerFn,
} from '../services/agent-engine.js';

interface AgentToolHandler {
  handle: (input: { request: Record<string, unknown> }) => Promise<unknown>;
}

export type AgentHandlerRegistry = Record<string, AgentToolHandler>;

export class AgentHandler {
  private handlers?: AgentHandlerRegistry;
  private executeHandler: ExecuteHandlerFn;
  private sessionContext?: import('../services/session-context.js').SessionContextManager;

  constructor(
    handlers?: AgentHandlerRegistry,
    options?: {
      sessionContext?: import('../services/session-context.js').SessionContextManager;
    }
  ) {
    this.handlers = handlers;
    this.sessionContext = options?.sessionContext;
    // Create executeHandler that dispatches to actual tool handlers
    this.executeHandler = async (tool: string, action: string, params: Record<string, unknown>) => {
      if (!this.handlers) {
        throw new HandlerLoadError('No handlers available for agent execution', 'AgentHandler');
      }
      // Map tool name to handler key
      const handlerKey = tool.replace('sheets_', '');
      const handler = this.handlers[handlerKey];
      if (!handler) {
        throw new HandlerLoadError(`Handler not found for tool: ${tool}`, tool, {
          availableTools: Object.keys(this.handlers),
        });
      }

      const result = await handler.handle({
        request: { action, ...params },
      });
      return result;
    };
  }

  private getResponsePayload(result: unknown): Record<string, unknown> | null {
    if (typeof result !== 'object' || result === null) {
      return null;
    }

    const resultRecord = result as Record<string, unknown>;
    const response = resultRecord['response'];
    if (typeof response === 'object' && response !== null) {
      return response as Record<string, unknown>;
    }

    return resultRecord;
  }

  private quoteSheetName(sheetName: string): string {
    return /^[A-Za-z0-9_]+$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  }

  private async gatherLivePlanningContext(spreadsheetId?: string): Promise<string | undefined> {
    if (!spreadsheetId || !this.handlers) {
      return undefined;
    }

    try {
      const scoutResult = await this.executeHandler('sheets_analyze', 'scout', {
        spreadsheetId,
        verbosity: 'minimal',
      });
      const scoutPayload = this.getResponsePayload(scoutResult);
      const scout = scoutPayload?.['scout'];
      if (typeof scout !== 'object' || scout === null) {
        return undefined;
      }

      const scoutSheets = Array.isArray((scout as Record<string, unknown>)['sheets'])
        ? ((scout as Record<string, unknown>)['sheets'] as Array<Record<string, unknown>>)
        : [];
      const rankedSheets = scoutSheets
        .filter((sheet) => typeof sheet === 'object' && sheet !== null)
        .sort((left, right) => {
          const leftEmpty =
            (left['flags'] as Record<string, unknown> | undefined)?.['isEmpty'] === true;
          const rightEmpty =
            (right['flags'] as Record<string, unknown> | undefined)?.['isEmpty'] === true;
          if (leftEmpty === rightEmpty) {
            return Number(right['rowCount'] ?? 0) - Number(left['rowCount'] ?? 0);
          }
          return leftEmpty ? 1 : -1;
        })
        .slice(0, 3);

      const parts: string[] = [];
      for (const sheet of rankedSheets) {
        const title = typeof sheet['title'] === 'string' ? sheet['title'] : undefined;
        if (!title) {
          continue;
        }

        const summaryParts = [
          `sheet="${title}"`,
          `rows=${Number(sheet['rowCount'] ?? 0)}`,
          `cols=${Number(sheet['columnCount'] ?? 0)}`,
        ];

        try {
          const readResult = await this.executeHandler('sheets_data', 'read', {
            spreadsheetId,
            range: `${this.quoteSheetName(title)}!1:3`,
            verbosity: 'minimal',
          });
          const readPayload = this.getResponsePayload(readResult);
          const values = Array.isArray(readPayload?.['values'])
            ? (readPayload?.['values'] as unknown[][])
            : [];
          const headerRow = Array.isArray(values[0]) ? values[0] : [];
          const sampleRow = Array.isArray(values[1]) ? values[1] : [];

          if (headerRow.length > 0) {
            summaryParts.push(`headers=${JSON.stringify(headerRow)}`);
          }
          if (sampleRow.length > 0) {
            summaryParts.push(`sample=${JSON.stringify(sampleRow)}`);
          }
        } catch {
          // Best-effort live context only.
        }

        parts.push(summaryParts.join(', '));
      }

      if (parts.length === 0) {
        return undefined; // OK: Explicit empty — no scout data to inject
      }

      return `\nSpreadsheet scout (live): ${parts.join(' | ')}`;
    } catch {
      return undefined; // OK: Explicit empty — scout is best-effort, never blocks plan
    }
  }

  async handle(input: SheetsAgentInput): Promise<SheetsAgentOutput> {
    const req = input.request;
    const startTime = Date.now();

    try {
      switch (req.action) {
        case 'plan': {
          // Enrich context with spreadsheet metadata from session for smarter planning
          let enrichedContext = req.context || '';
          if (this.sessionContext) {
            try {
              const summary = this.sessionContext.getSummary();
              if (summary.activeSpreadsheet) {
                const metaParts: string[] = [];
                if (summary.activeSpreadsheet.title) {
                  metaParts.push(`Title: ${summary.activeSpreadsheet.title}`);
                }
                if (summary.activeSpreadsheet.sheetNames?.length) {
                  metaParts.push(`Sheet names: ${summary.activeSpreadsheet.sheetNames.join(', ')}`);
                }
                if (summary.recentOperations?.length) {
                  const recentOps = summary.recentOperations
                    .slice(0, 5)
                    .map((op) => `${op.tool}.${op.action}${op.range ? ` on ${op.range}` : ''}`)
                    .join('; ');
                  metaParts.push(`Recent operations: ${recentOps}`);
                }
                if (metaParts.length > 0) {
                  const sessionMeta = `\nSpreadsheet metadata (from session): ${metaParts.join('; ')}`;
                  enrichedContext = enrichedContext ? enrichedContext + sessionMeta : sessionMeta;
                }
              }
            } catch {
              // Non-blocking: metadata enrichment is best-effort
            }
          }
          const livePlanningContext = await this.gatherLivePlanningContext(req.spreadsheetId);
          if (livePlanningContext) {
            enrichedContext = enrichedContext
              ? enrichedContext + livePlanningContext
              : livePlanningContext;
          }
          const plan = await compilePlanAI(
            req.description,
            req.maxSteps ?? 10,
            req.spreadsheetId,
            enrichedContext || undefined
          );
          return {
            response: {
              success: true,
              action: 'plan',
              planId: plan.planId,
              steps: plan.steps,
              summary: `Plan created with ${plan.steps.length} steps`,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'execute': {
          const result = await executePlan(
            req.planId,
            req.dryRun ?? false,
            this.executeHandler,
            req.interactiveMode ?? false
          );
          const completedSteps = result.results.filter((r) => r.success).length;

          // Record operation in session context for LLM follow-up references
          try {
            if (this.sessionContext) {
              this.sessionContext.recordOperation({
                tool: 'sheets_agent',
                action: 'execute',
                spreadsheetId: result.planId,
                description: `Executed agent plan ${result.planId}: ${completedSteps}/${result.steps.length} steps completed`,
                undoable: false,
              });
            }
          } catch {
            // Non-blocking: session context recording is best-effort
          }

          return {
            response: {
              success: true,
              action: 'execute',
              planId: result.planId,
              status: result.status,
              results: result.results,
              completedSteps,
              totalSteps: result.steps.length,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'execute_step': {
          const stepResult = await executeStep(req.planId, req.stepId, this.executeHandler);
          return {
            response: {
              success: true,
              action: 'execute_step',
              planId: req.planId,
              stepId: req.stepId,
              completed: stepResult.success,
              result: stepResult.result,
              error: stepResult.error,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'observe': {
          const checkpoint = createCheckpoint(req.planId, req.context);
          return {
            response: {
              success: true,
              action: 'observe',
              planId: req.planId,
              checkpointId: checkpoint.checkpointId,
              snapshot: { stepIndex: checkpoint.stepIndex },
              timestamp: checkpoint.timestamp,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'rollback': {
          const restored = rollbackToPlan(req.planId, req.checkpointId);
          return {
            response: {
              success: true,
              action: 'rollback',
              planId: req.planId,
              checkpointId: req.checkpointId,
              status: 'restored',
              restoredSteps: restored.currentStepIndex,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'get_status': {
          const plan = getPlanStatus(req.planId);
          if (!plan) {
            return {
              response: {
                success: false,
                error: {
                  code: ErrorCodes.NOT_FOUND,
                  message: `Plan ${req.planId} not found`,
                  retryable: false,
                },
              },
            };
          }
          const completedSteps = plan.results.filter((r) => r.success).length;
          return {
            response: {
              success: true,
              action: 'get_status',
              planId: plan.planId,
              status: plan.status,
              progress: {
                completedSteps,
                totalSteps: plan.steps.length,
                percentage:
                  plan.steps.length > 0
                    ? Math.round((completedSteps / plan.steps.length) * 100)
                    : 0,
              },
              currentStep: plan.steps[plan.currentStepIndex]?.stepId,
              error: plan.error,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'list_plans': {
          const plans = listPlans(req.limit ?? 20, req.status);
          return {
            response: {
              success: true,
              action: 'list_plans',
              plans: plans.map((p) => ({
                planId: p.planId,
                description: p.description,
                status: p.status,
                createdAt: p.createdAt,
                stepsCount: p.steps.length,
              })),
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        case 'resume': {
          const result = await resumePlan(req.planId, req.fromStepId, this.executeHandler);
          return {
            response: {
              success: true,
              action: 'resume',
              planId: result.planId,
              status: result.status,
              results: result.results,
              completedSteps: result.results.filter((r) => r.success).length,
              totalSteps: result.steps.length,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
        default:
          assertNever(req);
      }
    } catch (error) {
      return {
        response: {
          success: false,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        },
      };
    }
  }
}
