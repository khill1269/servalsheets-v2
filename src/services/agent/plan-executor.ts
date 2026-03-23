/**
 * Agent Engine — Plan Executor
 *
 * Executes agent plans step by step with:
 * - Pre-step schema validation
 * - Post-step result verification (hidden failure detection)
 * - AI reflexion validation (aiValidateStepResult)
 * - Error classification and auto-retry
 * - Recovery step injection
 * - Checkpointing before each step
 */

import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import type { ErrorDetail } from '../../schemas/shared.js';
import type {
  ExecutionStep,
  PlanState,
  StepResult,
  StepRunOutcome,
  ParsedHandlerResponse,
  ExecuteHandlerFn,
} from './types.js';
import { getToolInputSchemas } from './types.js';
import {
  getSamplingServer,
  assertSamplingConsent,
  withSamplingTimeout,
  createUserMessage,
  extractTextFromResult,
} from './sampling.js';
import { planStore, persistPlanState } from './plan-store.js';
import { createCheckpoint } from './checkpoints.js';

// ============================================================================
// Shared helpers
// ============================================================================

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function quoteSheetName(sheetName: string): string {
  return /^[A-Za-z0-9_]+$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
}

function getResponsePayload(result: unknown): ParsedHandlerResponse | null {
  if (!isPlainRecord(result)) {
    return null;
  }

  if (isPlainRecord(result['response'])) {
    return result['response'] as ParsedHandlerResponse;
  }

  return result as ParsedHandlerResponse;
}

function extractValuesFromResult(result: unknown): unknown[][] | undefined {
  const payload = getResponsePayload(result);
  if (!payload || !Array.isArray(payload.values)) {
    return undefined;
  }
  return payload.values as unknown[][];
}

function extractScoutSheets(
  result: unknown
): Array<
  Record<string, unknown> & { sheetId?: number; title?: string; name?: string; rowCount?: number }
> {
  const payload = getResponsePayload(result);
  const scout = payload?.scout;
  if (isPlainRecord(scout) && Array.isArray(scout['sheets'])) {
    return scout['sheets'].filter(isPlainRecord) as Array<
      Record<string, unknown> & {
        sheetId?: number;
        title?: string;
        name?: string;
        rowCount?: number;
      }
    >;
  }

  const payloadRecord = payload as Record<string, unknown> | null;
  if (isPlainRecord(payloadRecord) && Array.isArray(payloadRecord['sheets'])) {
    return payloadRecord['sheets'].filter(isPlainRecord) as Array<
      Record<string, unknown> & {
        sheetId?: number;
        title?: string;
        name?: string;
        rowCount?: number;
      }
    >;
  }

  return [];
}

// ============================================================================
// Step param helpers
// ============================================================================

export function getEffectiveStepParams(
  step: ExecutionStep,
  plan: Pick<PlanState, 'spreadsheetId'>
): Record<string, unknown> {
  return {
    ...(plan.spreadsheetId && step.params['spreadsheetId'] === undefined
      ? { spreadsheetId: plan.spreadsheetId }
      : {}),
    ...step.params,
  };
}

function formatIssuePath(pathSegments: Array<string | number>): string {
  const normalized = pathSegments[0] === 'request' ? pathSegments.slice(1) : pathSegments;
  return normalized.length > 0 ? normalized.join('.') : 'request';
}

// ============================================================================
// Error builders
// ============================================================================

function buildStepParamValidationError(
  step: ExecutionStep,
  issues: Array<{ path: Array<string | number>; message: string }>
): ErrorDetail {
  const fieldErrors = issues.slice(0, 5).map((issue) => ({
    field: formatIssuePath(issue.path),
    message: issue.message,
  }));
  const issueSummary = fieldErrors.map((issue) => `${issue.field}: ${issue.message}`).join('; ');

  return {
    code: 'INVALID_PARAMS',
    message: `Step ${step.stepId} has invalid params for ${step.tool}.${step.action}: ${issueSummary}`,
    retryable: false,
    suggestedFix: 'Correct the step parameters so they match the tool input schema.',
    resolutionSteps: [
      `Inspect the params for ${step.tool}.${step.action}`,
      'Fill in required fields and remove incompatible values',
      'Retry the step after the request validates',
    ],
    suggestedTools: [step.tool],
    details: {
      validationIssues: fieldErrors,
    },
  };
}

function buildStepVerificationError(
  step: ExecutionStep,
  issue: { message: string; details?: Record<string, unknown> }
): ErrorDetail {
  return {
    code: 'FAILED_PRECONDITION',
    message: `Post-step verification failed for ${step.tool}.${step.action}: ${issue.message}`,
    retryable: false,
    suggestedFix: 'Inspect the target range or sheet, then correct the step before retrying.',
    resolutionSteps: [
      `Review the target affected by ${step.tool}.${step.action}`,
      'Confirm the intended cells or sheet changed as expected',
      'Retry the step only after the mismatch is understood',
    ],
    suggestedTools: ['sheets_data', 'sheets_analyze', 'sheets_core'],
    details: issue.details,
  };
}

function buildHiddenFailureError(step: ExecutionStep, message: string): ErrorDetail {
  return {
    code: 'FAILED_PRECONDITION',
    message,
    retryable: false,
    suggestedFix: 'Inspect the tool response and correct the step before retrying.',
    resolutionSteps: [
      'Review the returned tool response for embedded error details',
      'Correct the underlying params or sheet state',
      'Retry the step once the hidden failure is resolved',
    ],
    suggestedTools: [step.tool],
  };
}

// ============================================================================
// Error classification
// ============================================================================

/**
 * Extract a structured ErrorDetail from an unknown thrown value.
 * Returns null if the error cannot be parsed as a structured error.
 */
export function extractErrorDetail(err: unknown): ErrorDetail | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;

  // Case 1: error already has an attached errorDetail property
  if (e['errorDetail'] && typeof e['errorDetail'] === 'object') {
    return e['errorDetail'] as ErrorDetail;
  }

  // Case 2: error has toErrorDetail() method
  if (typeof e['toErrorDetail'] === 'function') {
    try {
      return (e['toErrorDetail'] as () => ErrorDetail)();
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Build a recovery ExecutionStep from an error's fixableVia definition.
 */
export function buildRecoveryStep(errorDetail: ErrorDetail): ExecutionStep | null {
  if (!errorDetail.fixableVia) return null;
  return {
    stepId: `recovery-${randomUUID().slice(0, 8)}`,
    tool: errorDetail.fixableVia.tool,
    action: errorDetail.fixableVia.action,
    params: (errorDetail.fixableVia.params as Record<string, unknown> | undefined) ?? {},
    description: `Auto-recovery: ${errorDetail.suggestedFix ?? 'Fix error condition'}`,
    autoInserted: true,
  };
}

// ============================================================================
// Schema validation
// ============================================================================

function validateStepParamsAgainstSchema(
  step: ExecutionStep,
  plan: Pick<PlanState, 'spreadsheetId'>
): { params: Record<string, unknown>; errorDetail?: ErrorDetail } {
  const params = getEffectiveStepParams(step, plan);

  if (step.type === 'inject_cross_sheet_lookup' || step.tool === '__internal__') {
    return { params };
  }

  const inputSchema = getToolInputSchemas().get(step.tool);
  if (!inputSchema) {
    return { params };
  }

  const parseResult = inputSchema.safeParse({
    request: {
      action: step.action,
      ...params,
    },
  });

  if (parseResult.success) {
    const parsedData = parseResult.data as Record<string, unknown>;
    const parsedRequest = parsedData['request'];
    if (isPlainRecord(parsedRequest)) {
      const { action: _action, ...normalizedParams } = parsedRequest;
      return {
        params: normalizedParams,
      };
    }
    return {
      params,
    };
  }

  return {
    params,
    errorDetail: buildStepParamValidationError(
      step,
      parseResult.error.issues.map((issue) => ({
        path: issue.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: issue.message,
      }))
    ),
  };
}

// ============================================================================
// Hidden failure detection
// ============================================================================

/**
 * Validate a step result to detect hidden failures.
 *
 * Some tool responses return success:false buried inside the response object
 * without throwing. This function catches those cases and returns a diagnostic
 * string if the result is invalid, or null if it looks valid.
 */
function validateStepResult(result: unknown, step: ExecutionStep): string | null {
  if (result === null || result === undefined) {
    return `Step ${step.stepId} (${step.tool}.${step.action}) returned null/undefined`;
  }

  // Check for buried error in response.response.success === false
  const resultObj = result as Record<string, unknown>;
  const response = resultObj['response'] as Record<string, unknown> | undefined;
  if (response && response['success'] === false) {
    const error = response['error'] as Record<string, unknown> | undefined;
    const errorMsg = error?.['message'] ?? response['message'] ?? 'unknown error';
    return `Step ${step.stepId} (${step.tool}.${step.action}) returned success:false — ${errorMsg}`;
  }

  // Check for top-level success:false
  if (resultObj['success'] === false) {
    const errorMsg =
      (resultObj['error'] as Record<string, unknown>)?.['message'] ??
      resultObj['message'] ??
      'unknown error';
    return `Step ${step.stepId} (${step.tool}.${step.action}) returned success:false — ${errorMsg}`;
  }

  return null; // OK: Explicit valid result
}

// ============================================================================
// Post-step verification
// ============================================================================

type RangeVerificationTarget = {
  kind: 'range';
  action: 'write' | 'append' | 'clear';
  spreadsheetId: string;
  range: string;
  expectedValues?: unknown[][];
};

type SheetVerificationTarget = {
  kind: 'sheet';
  action: 'add_sheet' | 'delete_sheet';
  spreadsheetId: string;
  sheetId?: number;
  sheetName?: string;
  shouldExist: boolean;
};

type VerificationTarget = RangeVerificationTarget | SheetVerificationTarget;

function isCellEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function hasExpectedRows(actualValues: unknown[][], expectedValues: unknown[][]): boolean {
  if (expectedValues.length === 0) {
    return true;
  }

  const serializedExpected = expectedValues.map((row) => JSON.stringify(row));
  const serializedActual = actualValues.map((row) => JSON.stringify(row));

  for (let start = 0; start <= serializedActual.length - serializedExpected.length; start++) {
    const window = serializedActual.slice(start, start + serializedExpected.length);
    if (window.every((row, index) => row === serializedExpected[index])) {
      return true;
    }
  }

  return false;
}

function getA1Range(range: unknown): string | undefined {
  if (typeof range === 'string') {
    return range;
  }

  if (!isPlainRecord(range)) {
    return undefined;
  }

  if (typeof range['a1'] === 'string') {
    return range['a1'] as string;
  }

  if (typeof range['sheetName'] === 'string') {
    const sheetName = quoteSheetName(range['sheetName'] as string);
    const innerRange = typeof range['range'] === 'string' ? (range['range'] as string) : undefined;
    return innerRange ? `${sheetName}!${innerRange}` : sheetName;
  }

  return undefined;
}

function buildVerificationTarget(
  step: ExecutionStep,
  params: Record<string, unknown>
): VerificationTarget | null {
  const spreadsheetId =
    typeof params['spreadsheetId'] === 'string' ? (params['spreadsheetId'] as string) : undefined;
  const a1Range = getA1Range(params['range']);
  if (!spreadsheetId) {
    return null;
  }

  if (step.tool === 'sheets_data' && a1Range) {
    if (step.action === 'write' || step.action === 'append') {
      return {
        kind: 'range',
        action: step.action,
        spreadsheetId,
        range: a1Range,
        expectedValues: Array.isArray(params['values'])
          ? (params['values'] as unknown[][])
          : undefined,
      };
    }

    if (step.action === 'clear') {
      return {
        kind: 'range',
        action: 'clear',
        spreadsheetId,
        range: a1Range,
      };
    }
  }

  if (
    step.tool === 'sheets_core' &&
    step.action === 'add_sheet' &&
    typeof params['title'] === 'string'
  ) {
    return {
      kind: 'sheet',
      action: 'add_sheet',
      spreadsheetId,
      sheetName: params['title'] as string,
      shouldExist: true,
    };
  }

  if (step.tool === 'sheets_core' && step.action === 'delete_sheet') {
    return {
      kind: 'sheet',
      action: 'delete_sheet',
      spreadsheetId,
      sheetId: typeof params['sheetId'] === 'number' ? (params['sheetId'] as number) : undefined,
      shouldExist: false,
    };
  }

  return null;
}

async function verifyStepExecution(
  step: ExecutionStep,
  params: Record<string, unknown>,
  executeHandler: ExecuteHandlerFn
): Promise<{ message: string; details?: Record<string, unknown> } | null> {
  const target = buildVerificationTarget(step, params);
  if (!target) {
    return null;
  }

  try {
    if (target.kind === 'range') {
      const readResult = await executeHandler('sheets_data', 'read', {
        spreadsheetId: target.spreadsheetId,
        range: target.range,
        verbosity: 'minimal',
      });
      const actualValues = extractValuesFromResult(readResult) ?? [];

      if (target.action === 'clear') {
        const hasResidualValues = actualValues.some(
          (row) => Array.isArray(row) && row.some((cell) => !isCellEmpty(cell))
        );
        if (hasResidualValues) {
          return {
            message: `Range ${target.range} still contains values after clear`,
            details: {
              range: target.range,
              actualValues,
            },
          };
        }
        return null;
      }

      if (target.expectedValues && !hasExpectedRows(actualValues, target.expectedValues)) {
        return {
          message: `Range ${target.range} did not contain the expected values after ${target.action}`,
          details: {
            range: target.range,
            expectedValues: target.expectedValues,
            actualValues,
          },
        };
      }

      return null;
    }

    const scoutResult = await executeHandler('sheets_analyze', 'scout', {
      spreadsheetId: target.spreadsheetId,
      verbosity: 'minimal',
    });
    const sheets = extractScoutSheets(scoutResult);
    const matchedSheet = sheets.find((sheet) => {
      if (target.sheetId !== undefined && sheet['sheetId'] === target.sheetId) {
        return true;
      }
      if (target.sheetName !== undefined && sheet['title'] === target.sheetName) {
        return true;
      }
      return false;
    });

    if (target.shouldExist && !matchedSheet) {
      return {
        message: `Sheet ${target.sheetName ?? target.sheetId ?? 'unknown'} was not present after ${target.action}`,
        details: {
          sheetName: target.sheetName,
          sheetId: target.sheetId,
          availableSheets: sheets.map((sheet) => ({
            sheetId: sheet['sheetId'],
            title: sheet['title'],
          })),
        },
      };
    }

    if (!target.shouldExist && matchedSheet) {
      return {
        message: `Sheet ${target.sheetName ?? target.sheetId ?? 'unknown'} still exists after ${target.action}`,
        details: {
          sheetName: target.sheetName,
          sheetId: target.sheetId,
          matchedSheet,
        },
      };
    }

    return null;
  } catch (error) {
    return {
      message: `Could not confirm the post-step state for ${step.tool}.${step.action}`,
      details: {
        verificationTarget: target,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// ============================================================================
// Custom step executors
// ============================================================================

/**
 * Execute an inject_cross_sheet_lookup step.
 *
 * 1. Scouts the target sheet to discover the last occupied row.
 * 2. Builds XLOOKUP formula strings for each data row.
 * 3. Writes all formulas to the target column in a single write call.
 */
async function executeInjectCrossSheetLookup(
  step: ExecutionStep,
  plan: PlanState,
  executeHandler: ExecuteHandlerFn
): Promise<{ success: true; formulasWritten: number }> {
  const cfg = step.config as {
    sourceSheet: string;
    lookupCol: string;
    returnCol: string;
    targetSheet: string;
    targetCol: string;
    targetKeyCol: string;
    startRow: number;
  };
  const spreadsheetId =
    (step.params['spreadsheetId'] as string | undefined) ?? plan.spreadsheetId ?? plan.description;

  // Scout to discover the last occupied row in the target sheet
  const metaResult = await executeHandler('sheets_analyze', 'scout', {
    spreadsheetId,
    verbosity: 'minimal',
  });
  const sheetInfo = extractScoutSheets(metaResult).find(
    (sheet) => sheet['title'] === cfg.targetSheet || sheet['name'] === cfg.targetSheet
  );
  const lastRow = sheetInfo
    ? cfg.startRow + Math.max(0, Number(sheetInfo['rowCount'] ?? 0) - cfg.startRow)
    : cfg.startRow + 99;

  // Build XLOOKUP formula for each row in [startRow, lastRow]
  const formulas: string[][] = [];
  for (let row = cfg.startRow; row <= lastRow; row++) {
    formulas.push([
      `=IFERROR(XLOOKUP(${cfg.targetKeyCol}${row},'${cfg.sourceSheet}'!${cfg.lookupCol}:${cfg.lookupCol},'${cfg.sourceSheet}'!${cfg.returnCol}:${cfg.returnCol},""),"")`,
    ]);
  }

  await executeHandler('sheets_data', 'write', {
    spreadsheetId,
    range: `${quoteSheetName(cfg.targetSheet)}!${cfg.targetCol}${cfg.startRow}:${cfg.targetCol}${lastRow}`,
    values: formulas,
    valueInputOption: 'USER_ENTERED',
  });

  return { success: true, formulasWritten: formulas.length };
}

// ============================================================================
// AI reflexion validation
// ============================================================================

/**
 * AI reflexion validation for step results (IMP-03).
 * Uses MCP Sampling to check whether a step result looks correct.
 * Fails open — returns valid:true on any error to avoid blocking execution.
 */
export async function aiValidateStepResult(
  step: ExecutionStep,
  result: unknown
): Promise<{ valid: boolean; issue?: string; suggestedFix?: string }> {
  const samplingServer = getSamplingServer();
  if (!samplingServer) return { valid: true };

  try {
    await assertSamplingConsent();
    const resultStr = JSON.stringify(result, null, 2).slice(0, 500);
    const prompt = `Step "${step.description}" (${step.tool}.${step.action}) returned:
${resultStr}

Did this step succeed as expected? If the response shows success:false or an unexpected error, report it.
Reply with ONLY JSON (no markdown): { "valid": boolean, "issue"?: string, "suggestedFix"?: string }`;

    const response = await withSamplingTimeout(() =>
      samplingServer.createMessage({
        messages: [createUserMessage(prompt)],
        systemPrompt:
          'You are validating spreadsheet operation results. Reply with only valid JSON.',
        maxTokens: 200,
      })
    );

    const text = extractTextFromResult(response);
    if (!text) return { valid: true }; // OK: Empty sampling response — fail open
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned) as { valid: boolean; issue?: string; suggestedFix?: string };
    return { valid: parsed.valid ?? true, issue: parsed.issue, suggestedFix: parsed.suggestedFix };
  } catch {
    return { valid: true }; // OK: Fail open — don't block execution on validation errors
  }
}

// ============================================================================
// Step result accumulation
// ============================================================================

export function upsertStepResult(plan: PlanState, stepResult: StepResult): void {
  const existingIndex = plan.results.findIndex((result) => result.stepId === stepResult.stepId);
  if (existingIndex >= 0) {
    plan.results[existingIndex] = stepResult;
    return;
  }
  plan.results.push(stepResult);
}

// ============================================================================
// Core step runner
// ============================================================================

async function runStepWithGuards(
  plan: PlanState,
  step: ExecutionStep,
  executeHandler: ExecuteHandlerFn,
  checkpointContext: string,
  interactiveMode: boolean = false
): Promise<StepRunOutcome> {
  const startedAt = new Date().toISOString();
  createCheckpoint(plan.planId, checkpointContext);

  const validation = validateStepParamsAgainstSchema(step, plan);
  step.params = validation.params;

  if (validation.errorDetail) {
    return {
      status: 'pause',
      errorDetail: validation.errorDetail,
      stepResult: {
        stepId: step.stepId,
        success: false,
        error: validation.errorDetail.message,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const result =
      step.type === 'inject_cross_sheet_lookup' || step.action === 'inject_cross_sheet_lookup'
        ? await executeInjectCrossSheetLookup(step, plan, executeHandler)
        : await executeHandler(step.tool, step.action, validation.params);

    const validationIssue = validateStepResult(result, step);
    if (validationIssue) {
      logger.warn('Step result validation failed', {
        planId: plan.planId,
        stepId: step.stepId,
        issue: validationIssue,
      });
      return {
        status: 'pause',
        errorDetail: buildHiddenFailureError(step, validationIssue),
        stepResult: {
          stepId: step.stepId,
          success: false,
          result,
          error: validationIssue,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
    }

    const samplingServer = getSamplingServer();
    if (samplingServer) {
      const aiValidation = await aiValidateStepResult(step, result);
      if (!aiValidation.valid && aiValidation.issue) {
        logger.warn('AI step validation detected issue', {
          planId: plan.planId,
          stepId: step.stepId,
          issue: aiValidation.issue,
          suggestedFix: aiValidation.suggestedFix,
        });
      }
    }

    const verificationIssue = await verifyStepExecution(step, validation.params, executeHandler);
    if (verificationIssue) {
      const errorDetail = buildStepVerificationError(step, verificationIssue);
      return {
        status: 'pause',
        errorDetail,
        stepResult: {
          stepId: step.stepId,
          success: false,
          result,
          error: errorDetail.message,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
    }

    return {
      status: 'success',
      stepResult: {
        stepId: step.stepId,
        success: true,
        result,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const errorDetail = extractErrorDetail(err);
    const errAsObj = err as Record<string, unknown>;
    const isRetryable =
      errorDetail?.retryable === true || (err instanceof Error && errAsObj['isRetryable'] === true);
    const retryAfterMs =
      errorDetail?.retryAfterMs ??
      (typeof errAsObj['retryAfterMs'] === 'number'
        ? (errAsObj['retryAfterMs'] as number)
        : undefined);

    if (isRetryable && retryAfterMs !== undefined && step.retryCount === undefined) {
      step.retryCount = 1;
      logger.debug('Auto-retrying retryable step error', {
        planId: plan.planId,
        stepId: step.stepId,
        retryAfterMs,
        errorCode: errorDetail?.code,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(retryAfterMs, 30000)));
      return {
        status: 'retry',
        retryAfterMs,
      };
    }

    return {
      status: 'pause',
      errorDetail: errorDetail ?? undefined,
      recoveryStep: errorDetail ? buildRecoveryStep(errorDetail) : null,
      stepResult: {
        stepId: step.stepId,
        success: false,
        error,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// Public execution API
// ============================================================================

/**
 * Execute all steps in a plan sequentially.
 * Creates checkpoints before each step, records results.
 * On error: pauses execution, records error.
 */
export async function executePlan(
  planId: string,
  dryRun: boolean,
  executeHandler: ExecuteHandlerFn,
  interactiveMode: boolean = false
): Promise<PlanState> {
  const plan = planStore.get(planId);
  if (!plan) {
    throw new NotFoundError('plan', planId);
  }

  if (dryRun) {
    // Preview execution without actual tool calls
    const now = new Date().toISOString();
    const previewResults: StepResult[] = plan.steps.map((step) => ({
      stepId: step.stepId,
      success: true,
      result: { dryRunPreview: true, action: step.action },
      startedAt: now,
      completedAt: now,
    }));

    plan.status = 'completed';
    plan.results = previewResults;
    plan.updatedAt = now;
    planStore.set(planId, plan);
    return plan;
  }

  // Real execution
  const now = new Date().toISOString();
  plan.status = 'executing';
  plan.updatedAt = now;

  for (let i = plan.currentStepIndex; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (!step) continue; // Safety: skip if step is undefined
    const outcome = await runStepWithGuards(
      plan,
      step,
      executeHandler,
      `Before step: ${step.description}`,
      interactiveMode
    );

    if (outcome.status === 'retry') {
      i--;
      continue;
    }

    if (outcome.stepResult) {
      upsertStepResult(plan, outcome.stepResult);
    }

    if (outcome.status === 'pause') {
      plan.status = 'paused';
      plan.error = outcome.stepResult?.error ?? outcome.errorDetail?.message;
      plan.errorDetail = outcome.errorDetail;

      if (outcome.recoveryStep) {
        plan.steps.splice(i + 1, 0, outcome.recoveryStep);
        logger.debug('Inserted auto-recovery step', {
          planId,
          recoveryStepId: outcome.recoveryStep.stepId,
          tool: outcome.recoveryStep.tool,
          action: outcome.recoveryStep.action,
        });
      }

      persistPlanState(plan);
      return plan;
    }

    plan.currentStepIndex = i + 1;
    plan.error = undefined;
    plan.errorDetail = undefined;

    // In interactive mode, pause after each successful step for user review
    if (interactiveMode) {
      plan.status = 'paused';
      plan.error = `Step ${plan.currentStepIndex - 1} completed — awaiting approval to continue`;
      logger.debug('Interactive mode: pausing after step completion', {
        planId,
        completedStep: plan.currentStepIndex - 1,
        totalSteps: plan.steps.length,
      });
      persistPlanState(plan);
      return plan;
    }

    persistPlanState(plan);
  }

  plan.status = 'completed';
  persistPlanState(plan);
  return plan;
}

/**
 * Execute a single step from an existing plan.
 */
export async function executeStep(
  planId: string,
  stepId: string,
  executeHandler: ExecuteHandlerFn
): Promise<StepResult> {
  const plan = planStore.get(planId);
  if (!plan) {
    throw new NotFoundError('plan', planId);
  }

  const step = plan.steps.find((s) => s.stepId === stepId);
  if (!step) {
    throw new NotFoundError('step', `${stepId} in plan ${planId}`);
  }

  const stepIndex = plan.steps.findIndex((candidate) => candidate.stepId === stepId);
  while (true) {
    const outcome = await runStepWithGuards(
      plan,
      step,
      executeHandler,
      `Execute step: ${step.description}`
    );

    if (outcome.status === 'retry') {
      continue;
    }

    const stepResult =
      outcome.stepResult ??
      ({
        stepId,
        success: false,
        error: outcome.errorDetail?.message ?? 'Step execution failed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } satisfies StepResult);

    upsertStepResult(plan, stepResult);

    if (outcome.status === 'pause') {
      plan.status = 'paused';
      plan.error = stepResult.error ?? outcome.errorDetail?.message;
      plan.errorDetail = outcome.errorDetail;

      if (outcome.recoveryStep && stepIndex >= 0) {
        plan.steps.splice(stepIndex + 1, 0, outcome.recoveryStep);
      }

      persistPlanState(plan);
      return stepResult;
    }

    plan.error = undefined;
    plan.errorDetail = undefined;
    plan.currentStepIndex = Math.max(plan.currentStepIndex, stepIndex + 1);
    if (plan.currentStepIndex >= plan.steps.length) {
      plan.status = 'completed';
    }
    persistPlanState(plan);
    return stepResult;
  }
}

/**
 * Resume execution from a paused plan.
 * If fromStepId provided, resume from that step.
 * Otherwise resume from where it paused.
 */
export async function resumePlan(
  planId: string,
  fromStepId: string | undefined,
  executeHandler: ExecuteHandlerFn
): Promise<PlanState> {
  const plan = planStore.get(planId);
  if (!plan) {
    throw new NotFoundError('plan', planId);
  }

  if (plan.status !== 'paused') {
    throw new ValidationError(
      `Plan ${planId} is not paused (status: ${plan.status})`,
      'planId',
      'plan in paused status'
    );
  }

  // Determine resume position
  if (fromStepId) {
    const stepIdx = plan.steps.findIndex((s) => s.stepId === fromStepId);
    if (stepIdx < 0) {
      throw new NotFoundError('step', `${fromStepId} in plan ${planId}`);
    }
    plan.currentStepIndex = stepIdx;
  }

  // Resume execution
  return executePlan(planId, false, executeHandler);
}
