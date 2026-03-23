import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import {
  ActionGenerator,
  type AnalysisFinding,
  type GenerateActionsResult,
} from '../../analysis/action-generator.js';
import { FlowOrchestrator } from '../../analysis/flow-orchestrator.js';
import { Planner, type AnalysisPlan } from '../../analysis/planner.js';
import { Scout, type ScoutResult } from '../../analysis/scout.js';
import { generateAIInsight, type SamplingServer } from '../../mcp/sampling.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { getSessionContext, type SessionContextManager } from '../../services/session-context.js';
import { getCacheAdapter } from '../../utils/cache-adapter.js';
import { logger } from '../../utils/logger.js';

type PlanRequest = {
  spreadsheetId: string;
  intent?: ScoutResult['detectedIntent'];
  scoutResult?: unknown;
};

type ExecutePlanRequest = {
  spreadsheetId: string;
  plan: {
    steps: Array<{ type: string }>;
  };
};

type DrillDownTarget =
  | { type: 'issue'; issueId: string }
  | { type: 'sheet'; sheetIndex: number }
  | { type: 'column'; column: string }
  | { type: 'formula'; cell: string }
  | { type: 'pattern'; patternId: string }
  | { type: 'anomaly'; anomalyId: string }
  | { type: 'correlation'; columns: string[] };

type DrillDownRequest = {
  spreadsheetId: string;
  target: DrillDownTarget;
  limit?: number;
};

type GenerateActionsRequest = {
  spreadsheetId: string;
  intent?: string;
  findings?: unknown;
  maxActions?: number;
};

interface GenerateActionsDeps {
  sessionContext?: Pick<SessionContextManager, 'understandingStore'>;
}

type FindingSource = 'findings' | 'issues' | 'errors';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSeverity(
  value: unknown,
  fallback: AnalysisFinding['severity']
): AnalysisFinding['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'critical'
    ? value
    : fallback;
}

function severityFromErrorType(errorType: unknown): AnalysisFinding['severity'] | undefined {
  switch (errorType) {
    case '#REF!':
      return 'critical';
    case '#DIV/0!':
    case '#NULL!':
    case '#N/A':
      return 'warning';
    case '#VALUE!':
    case '#NAME?':
    case '#ERROR!':
      return 'error';
    default:
      return undefined;
  }
}

function extractSheetNameFromCell(cell: string | undefined): string | undefined {
  if (!cell) {
    return undefined;
  }

  const match = cell.match(/^(?:'([^']+)'!|([^!]+)!)/);
  return match?.[1] ?? match?.[2];
}

function normalizeLocation(
  location: unknown,
  fallbackRange?: string
): AnalysisFinding['location'] | undefined {
  const normalized: NonNullable<AnalysisFinding['location']> = {};
  const locationRecord = isRecord(location) ? location : undefined;

  if (locationRecord && typeof locationRecord['sheetId'] === 'number') {
    normalized.sheetId = locationRecord['sheetId'];
  }
  if (locationRecord && typeof locationRecord['sheetName'] === 'string') {
    normalized.sheetName = locationRecord['sheetName'];
  }
  if (locationRecord && typeof locationRecord['range'] === 'string') {
    normalized.range = locationRecord['range'];
  } else if (fallbackRange) {
    normalized.range = fallbackRange;
  }

  if (locationRecord && Array.isArray(locationRecord['cells'])) {
    const cells = locationRecord['cells']
      .map((cell) => {
        if (!isRecord(cell)) {
          return null;
        }
        const row = cell['row'];
        const col = cell['col'];
        if (typeof row !== 'number' || typeof col !== 'number') {
          return null;
        }
        return { row, col };
      })
      .filter((cell): cell is { row: number; col: number } => cell !== null);

    if (cells.length > 0) {
      normalized.cells = cells;
    }
  }

  if (!normalized.sheetName && normalized.range) {
    normalized.sheetName = extractSheetNameFromCell(normalized.range);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toAnalysisFinding(
  candidate: unknown,
  index: number,
  source: FindingSource
): AnalysisFinding | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const cell = typeof candidate['cell'] === 'string' ? candidate['cell'] : undefined;
  const title =
    typeof candidate['title'] === 'string'
      ? candidate['title']
      : typeof candidate['errorType'] === 'string'
        ? `${candidate['errorType']} at ${cell ?? `item ${index + 1}`}`
        : typeof candidate['issue'] === 'string'
          ? candidate['issue']
          : `Issue ${index + 1}`;
  const description =
    typeof candidate['description'] === 'string'
      ? candidate['description']
      : typeof candidate['rootCause'] === 'string'
        ? candidate['rootCause']
        : typeof candidate['issue'] === 'string'
          ? candidate['issue']
          : '';

  const fallbackSeverity =
    severityFromErrorType(candidate['errorType']) ??
    (source === 'errors' ? 'error' : source === 'issues' ? 'warning' : 'warning');

  const data = isRecord(candidate['data']) ? { ...candidate['data'] } : {};
  if (typeof candidate['errorType'] === 'string') {
    data['errorType'] = candidate['errorType'];
    data['findingType'] = data['findingType'] ?? 'formula_error';
  }
  if (typeof candidate['formula'] === 'string') {
    data['formula'] = candidate['formula'];
  }
  if (typeof candidate['suggestedFix'] === 'string') {
    data['suggestedFix'] = candidate['suggestedFix'];
  }
  if (Array.isArray(candidate['dependencyChain'])) {
    data['dependencyChain'] = candidate['dependencyChain'];
  }
  if (typeof candidate['issue'] === 'string' && data['findingType'] === undefined) {
    data['findingType'] = 'issue';
  }

  return {
    id: typeof candidate['id'] === 'string' ? candidate['id'] : `${source}_${index}`,
    type:
      candidate['type'] === 'issue' ||
      candidate['type'] === 'opportunity' ||
      candidate['type'] === 'insight'
        ? candidate['type']
        : 'issue',
    severity: normalizeSeverity(candidate['severity'], fallbackSeverity),
    title,
    description,
    location: normalizeLocation(candidate['location'], cell),
    data: Object.keys(data).length > 0 ? data : undefined,
  };
}

function pushNormalizedFindings(
  output: AnalysisFinding[],
  candidates: unknown[],
  source: FindingSource
): void {
  const startIndex = output.length;
  candidates.forEach((candidate, index) => {
    const normalized = toAnalysisFinding(candidate, startIndex + index, source);
    if (normalized) {
      output.push(normalized);
    }
  });
}

function mapActionToStepType(
  action: string
): 'quality' | 'formulas' | 'patterns' | 'performance' | 'structure' | 'visualizations' {
  const mapping: Record<
    string,
    'quality' | 'formulas' | 'patterns' | 'performance' | 'structure' | 'visualizations'
  > = {
    analyze_quality: 'quality',
    analyze_formulas: 'formulas',
    detect_patterns: 'patterns',
    analyze_performance: 'performance',
    analyze_structure: 'structure',
    suggest_visualization: 'visualizations',
    comprehensive: 'quality',
    analyze_data: 'patterns',
  };
  return mapping[action] ?? 'quality';
}

function mapPriorityToSchema(priority: number): 'critical' | 'high' | 'medium' | 'low' {
  if (priority <= 1) return 'critical';
  if (priority <= 3) return 'high';
  if (priority <= 6) return 'medium';
  return 'low';
}

/**
 * Decomposed action handler for `plan`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handlePlanAction(
  input: PlanRequest,
  sheetsApi: sheets_v4.Sheets
): Promise<AnalyzeResponse> {
  logger.info('Plan action - AI-assisted analysis planning', {
    spreadsheetId: input.spreadsheetId,
    intent: input.intent,
  });

  try {
    let scoutResult: ScoutResult;
    if (input.scoutResult) {
      scoutResult = input.scoutResult as ScoutResult;
    } else {
      const cache = getCacheAdapter('analysis');
      const scoutInstance = new Scout({
        cache,
        sheetsApi,
      });
      scoutResult = await scoutInstance.scout(input.spreadsheetId);
    }

    const planner = new Planner({
      maxSteps: 10,
      includeOptional: true,
    });
    const plan: AnalysisPlan = planner.createPlan(scoutResult, undefined, input.intent);

    const mappedSteps = plan.steps.map((step, idx) => ({
      order: idx + 1,
      type: mapActionToStepType(step.action),
      priority: mapPriorityToSchema(step.sequence),
      target: step.params['sheetId']
        ? { sheets: [step.params['sheetId'] as number] }
        : step.params['range']
          ? { range: step.params['range'] as string }
          : undefined,
      estimatedDuration: `${Math.round(step.estimatedLatencyMs / 1000)}s`,
      reason: step.description,
      outputs: [step.title],
    }));

    return {
      success: true,
      action: 'plan',
      plan: {
        id: plan.planId,
        intent: plan.intent,
        steps: mappedSteps,
        estimatedTotalDuration: `${Math.round(plan.totalEstimatedLatencyMs / 1000)}s`,
        estimatedApiCalls: plan.steps.length,
        confidenceScore: Math.round(scoutResult.intentConfidence * 100),
        rationale: plan.description,
        skipped: [],
      },
      duration: Date.now() - plan.metadata.createdAt,
      message: `Analysis plan created: ${plan.steps.length} steps, ~${Math.round(plan.totalEstimatedLatencyMs / 1000)}s estimated`,
    };
  } catch (error) {
    logger.error('Plan creation failed', {
      spreadsheetId: input.spreadsheetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message:
          'Plan creation failed. The AI analysis service may be temporarily unavailable. Please try again.',
        retryable: true,
      },
    };
  }
}

/**
 * Decomposed action handler for `execute_plan`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleExecutePlanAction(input: ExecutePlanRequest): Promise<AnalyzeResponse> {
  logger.info('Execute plan action', {
    spreadsheetId: input.spreadsheetId,
    steps: input.plan.steps.length,
  });

  const planSteps = input.plan.steps || [];
  const stepResults = planSteps.map((step, idx) => ({
    stepIndex: idx,
    type: step.type,
    status: 'completed' as const,
    duration: 0,
    findings: {},
    issuesFound: 0,
  }));

  return {
    success: true,
    action: 'execute_plan',
    stepResults,
    summary: `Plan ready: ${planSteps.length} steps to execute`,
    message: `Plan ready for execution: ${planSteps.length} steps. Execute each step sequentially using sheets_analyze with the specified action.`,
  };
}

/**
 * Decomposed action handler for `drill_down`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleDrillDownAction(
  input: DrillDownRequest,
  samplingServer?: SamplingServer
): Promise<AnalyzeResponse> {
  logger.info('Drill down action', {
    spreadsheetId: input.spreadsheetId,
    targetType: input.target.type,
  });

  try {
    const targetType = input.target.type;
    let targetId = '';

    switch (targetType) {
      case 'issue':
        targetId = input.target.issueId;
        break;
      case 'sheet':
        targetId = String(input.target.sheetIndex);
        break;
      case 'column':
        targetId = input.target.column;
        break;
      case 'formula':
        targetId = input.target.cell;
        break;
      case 'pattern':
        targetId = input.target.patternId;
        break;
      case 'anomaly':
        targetId = input.target.anomalyId;
        break;
      case 'correlation':
        targetId = input.target.columns.join('-');
        break;
    }

    const drillDownContext = {
      targetType,
      targetId,
      spreadsheetId: input.spreadsheetId,
    };
    const aiInsightDrill = await generateAIInsight(
      samplingServer,
      'dataAnalysis',
      'Based on this drill-down analysis, suggest the most promising next direction to explore',
      drillDownContext
    );

    return {
      success: true,
      action: 'drill_down',
      drillDownResult: {
        targetType,
        targetId,
        context: {
          spreadsheetId: input.spreadsheetId,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        },
        details: {
          type: targetType,
          id: targetId,
          analysisReady: true,
        },
        relatedItems: [],
        suggestions: [
          `Run sheets_analyze:analyze_${targetType === 'sheet' ? 'structure' : targetType === 'formula' ? 'formulas' : 'quality'} for detailed analysis`,
          'Use sheets_analyze:detect_patterns to find related patterns',
        ],
      },
      aiInsight: aiInsightDrill,
      message: `Drill-down result for ${targetType}: ${targetId}`,
    };
  } catch (drillError) {
    logger.error('Drill-down analysis failed', {
      error: drillError instanceof Error ? drillError.message : String(drillError),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message:
          'Drill-down analysis failed. The AI analysis service may be temporarily unavailable. Please try again.',
        retryable: true,
      },
    };
  }
}

/**
 * Decomposed action handler for `generate_actions`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleGenerateActionsAction(
  input: GenerateActionsRequest,
  deps?: GenerateActionsDeps
): Promise<AnalyzeResponse> {
  logger.info('Generate actions', { spreadsheetId: input.spreadsheetId, intent: input.intent });

  try {
    const analysisFindings: AnalysisFinding[] = [];

    if (input.findings) {
      if (Array.isArray(input.findings)) {
        pushNormalizedFindings(analysisFindings, input.findings, 'findings');
      } else if (isRecord(input.findings)) {
        const findingsData = input.findings;
        const canonicalFindings = Array.isArray(findingsData['findings'])
          ? findingsData['findings']
          : [];
        const issueFindings = Array.isArray(findingsData['issues']) ? findingsData['issues'] : [];
        const errorFindings = Array.isArray(findingsData['errors']) ? findingsData['errors'] : [];

        if (canonicalFindings.length > 0) {
          pushNormalizedFindings(analysisFindings, canonicalFindings, 'findings');
        } else if (issueFindings.length > 0) {
          pushNormalizedFindings(analysisFindings, issueFindings, 'issues');
        } else if (errorFindings.length > 0) {
          pushNormalizedFindings(analysisFindings, errorFindings, 'errors');
        }
      }
    }

    const generator = new ActionGenerator();
    const result: GenerateActionsResult = generator.generateActions({
      spreadsheetId: input.spreadsheetId,
      findings: analysisFindings,
      maxActions: input.maxActions ?? 10,
    });

    const response: AnalyzeResponse = {
      success: true,
      action: 'generate_actions',
      actionPlan: {
        totalActions: result.actions.length,
        estimatedTotalImpact: `${result.summary.actionableFindings} issues addressed`,
        actions: result.actions.map((a) => ({
          id: a.id,
          priority: a.priority,
          tool: a.tool,
          action: a.action,
          params: a.params,
          title: a.title,
          description: a.description,
          risk: a.risk,
          reversible: a.reversible,
          requiresConfirmation: a.requiresConfirmation,
          category: a.category,
        })) as unknown as NonNullable<
          NonNullable<Extract<AnalyzeResponse, { success: true }>['actionPlan']>['actions']
        >,
      },
      message: `Generated ${result.actions.length} actions from ${result.summary.totalFindings} findings`,
    };

    try {
      const orchestrator = new FlowOrchestrator();
      const store =
        deps?.sessionContext?.understandingStore ?? getSessionContext().understandingStore;
      const summary = store.getSummary(input.spreadsheetId);
      const suggestions = orchestrator.suggestMultiToolChains(summary, {
        tool: 'sheets_analyze',
        action: 'generate_actions',
      });
      if (suggestions.length > 0) {
        (response as Record<string, unknown>)['suggestedFlows'] = suggestions.map((s) => ({
          title: s.title,
          reason: s.reason,
          steps: s.toolChain.map((t) => `${t.tool}.${t.action}`),
          confidence: s.confidence,
        }));
      }
    } catch (intelligenceErr) {
      logger.warn('Intelligence cluster flow suggestions failed (non-critical)', {
        spreadsheetId: input.spreadsheetId,
        error: intelligenceErr instanceof Error ? intelligenceErr.message : String(intelligenceErr),
      });
    }

    return response;
  } catch (error) {
    logger.error('Generate actions failed', {
      spreadsheetId: input.spreadsheetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message:
          'Action generation failed. The AI analysis service may be temporarily unavailable. Please try again.',
        retryable: true,
      },
    };
  }
}
