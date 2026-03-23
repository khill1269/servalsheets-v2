import { recordToolCall, recordSelfCorrection } from '../observability/metrics.js';

const SELF_CORRECTION_WINDOW_MS = 5 * 60 * 1000;
const recentToolFailures = new Map<string, { action: string; timestampMs: number }>();

function buildSelfCorrectionKey(principalId: string, toolName: string): string {
  return `${principalId}:${toolName}`;
}

function pruneOldSelfCorrectionFailures(nowMs: number): void {
  for (const [key, value] of recentToolFailures.entries()) {
    if (nowMs - value.timestampMs > SELF_CORRECTION_WINDOW_MS) {
      recentToolFailures.delete(key);
    }
  }
}

function isToolResultError(result: unknown): {
  isError: boolean;
  errorDetail: unknown;
} {
  const response =
    typeof result === 'object' && result !== null
      ? (result as { response?: { success?: boolean; error?: unknown } }).response
      : undefined;
  const isError =
    response?.success === false ||
    (typeof result === 'object' &&
      result !== null &&
      'success' in result &&
      (result as { success?: boolean }).success === false);
  const errorDetail =
    response?.success === false ? response.error : (result as { error?: unknown }).error;

  return { isError, errorDetail };
}

export function recordToolExecutionResult(params: {
  toolName: string;
  action: string;
  durationSeconds: number;
  result: unknown;
  principalId: string;
  warn: (message: string, meta: Record<string, unknown>) => void;
}): void {
  const { toolName, action, durationSeconds, result, principalId, warn } = params;
  const nowMs = Date.now();
  pruneOldSelfCorrectionFailures(nowMs);
  const correctionKey = buildSelfCorrectionKey(principalId, toolName);
  const { isError, errorDetail } = isToolResultError(result);

  if (isError) {
    warn('Tool call failed', {
      tool: toolName,
      error: errorDetail,
    });
    recordToolCall(toolName, action, 'error', durationSeconds);
    recentToolFailures.set(correctionKey, { action, timestampMs: nowMs });
    return;
  }

  recordToolCall(toolName, action, 'success', durationSeconds);
  const priorFailure = recentToolFailures.get(correctionKey);
  if (priorFailure && nowMs - priorFailure.timestampMs <= SELF_CORRECTION_WINDOW_MS) {
    recordSelfCorrection(toolName, priorFailure.action, action);
    recentToolFailures.delete(correctionKey);
  }
}

export function recordToolExecutionException(params: {
  toolName: string;
  action: string;
  durationSeconds: number;
  principalId: string;
}): void {
  const { toolName, action, durationSeconds, principalId } = params;
  const nowMs = Date.now();

  recordToolCall(toolName, action, 'error', durationSeconds);
  pruneOldSelfCorrectionFailures(nowMs);

  const correctionKey = buildSelfCorrectionKey(principalId, toolName);
  recentToolFailures.set(correctionKey, { action, timestampMs: nowMs });
}
