import { z } from 'zod';
import { createZodValidationError } from '../../utils/error-factory.js';
import { extractAction } from './extraction-helpers.js';
import { getIssueCode, normalizeIssuePath } from './tool-arg-normalization.js';
import { getToolDiscoveryHint } from './tool-discovery-hints.js';

type PlainRecord = Record<string, unknown>;

export interface ToolExecutionErrorPayload {
  errorCode: string;
  errorMessage: string;
  errorPayload: PlainRecord;
}

function buildValidationGuidance(
  toolName: string,
  args: Record<string, unknown> | undefined
): PlainRecord {
  const hint = getToolDiscoveryHint(toolName);
  if (!hint) {
    return {
      suggestedFix:
        'Check the tool description and inline action parameter hints for the required fields and request shape.',
    };
  }

  const attemptedAction = args ? extractAction(args) : 'unknown';
  const actionHint = hint.actionParams[attemptedAction];

  if (!actionHint) {
    const availableActions = Object.keys(hint.actionParams).sort();
    const preview = availableActions.slice(0, 10).join(', ');
    const suffix =
      availableActions.length > 10 ? ` (showing 10 of ${availableActions.length})` : '';

    return {
      availableActions,
      suggestedFix:
        `Use a valid action and include its required fields. Available actions include: ${preview}${suffix}. ` +
        'Action-specific parameter hints are inline in the tool input schema description.',
    };
  }

  const requiredSegments = [...actionHint.required];
  if (actionHint.requiredOneOf) {
    requiredSegments.push(...actionHint.requiredOneOf.map((group) => group.join(' or ')));
  }
  const requiredFields =
    requiredSegments.length > 0 ? requiredSegments.join(', ') : 'no additional fields';

  return {
    expectedParams: {
      action: attemptedAction,
      required: actionHint.required,
      ...(actionHint.requiredOneOf ? { requiredOneOf: actionHint.requiredOneOf } : {}),
      ...(actionHint.optional ? { optional: actionHint.optional } : {}),
      ...(actionHint.description ? { description: actionHint.description } : {}),
    },
    suggestedFix:
      `Use request.action="${attemptedAction}" with required fields: ${requiredFields}. ` +
      'Check the tool description for the canonical request shape and examples.',
  };
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getThrownErrorCode(error: unknown): string | undefined {
  if (!isPlainRecord(error)) {
    return undefined;
  }

  return typeof error['code'] === 'string' ? error['code'] : undefined;
}

export function buildToolExecutionErrorPayload(
  error: unknown,
  toolName: string,
  args?: Record<string, unknown>
): ToolExecutionErrorPayload {
  const errorMessage = error instanceof Error ? error.message : String(error);
  let errorCode = getThrownErrorCode(error) ?? 'INTERNAL_ERROR';
  const errorPayload: PlainRecord = {
    code: errorCode,
    message: errorMessage,
    retryable: false,
  };

  if (error instanceof z.ZodError) {
    const validationError = createZodValidationError(
      error.issues.map((issue) => {
        const issueRecord = issue as unknown as PlainRecord;
        const options = issueRecord['options'];
        const expected = issueRecord['expected'];
        const received = issueRecord['received'];

        return {
          code: getIssueCode(issue),
          path: normalizeIssuePath(issue.path),
          message: issue.message,
          options: Array.isArray(options) ? options : undefined,
          expected: typeof expected === 'string' ? expected : undefined,
          received: typeof received === 'string' ? received : undefined,
        };
      }),
      toolName
    );

    errorCode = 'INVALID_PARAMS';
    errorPayload['code'] = 'INVALID_PARAMS';
    errorPayload['message'] = validationError.message;
    errorPayload['retryable'] = validationError.retryable;
    Object.assign(errorPayload, buildValidationGuidance(toolName, args));
    if (validationError.category) {
      errorPayload['category'] = validationError.category;
    }
    if (validationError.severity) {
      errorPayload['severity'] = validationError.severity;
    }
    if (validationError.resolution) {
      errorPayload['resolution'] = validationError.resolution;
    }
    if (validationError.resolutionSteps) {
      errorPayload['resolutionSteps'] = validationError.resolutionSteps;
    }
  }

  return {
    errorCode,
    errorMessage,
    errorPayload,
  };
}
