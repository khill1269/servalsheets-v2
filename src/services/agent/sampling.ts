/**
 * Agent Engine — Sampling Utilities
 *
 * MCP Sampling integration for AI-powered plan generation and step validation.
 * Includes timeout wrapper, consent enforcement, and response extraction helpers.
 */

import { assertSamplingConsent as assertGlobalSamplingConsent } from '../../mcp/sampling.js';
import { createRequestAbortError, getRequestContext } from '../../utils/request-context.js';
import type { SamplingServer, SamplingMessage, SamplingCreateMessageResult } from './types.js';

export type { SamplingServer };

type ConsentChecker = (() => Promise<void>) | undefined;

const SAMPLING_TIMEOUT_MS = parseInt(process.env['SAMPLING_TIMEOUT_MS'] ?? '30000', 10);

type SamplingOperation<T> = Promise<T> | (() => Promise<T>);

// ============================================================================
// Module-level state (mutable via setters — kept here to co-locate with usage)
// ============================================================================

let _samplingServer: SamplingServer | undefined;
let _consentChecker: ConsentChecker;

/**
 * Register the sampling server for AI-powered plan generation.
 * Optional — if not provided, falls back to regex-based planning.
 */
export function setAgentSamplingServer(server: SamplingServer | undefined): void {
  _samplingServer = server;
}

/**
 * Optional consent checker invoked before AI sampling requests.
 * Keeps consent enforcement pluggable without coupling service layer to MCP internals.
 */
export function setAgentSamplingConsentChecker(checker: ConsentChecker): void {
  _consentChecker = checker;
}

export function getSamplingServer(): SamplingServer | undefined {
  return _samplingServer;
}

// ============================================================================
// Helpers
// ============================================================================

export function getEffectiveSamplingTimeout(deadline: number | undefined): number {
  if (!Number.isFinite(SAMPLING_TIMEOUT_MS) || SAMPLING_TIMEOUT_MS <= 0) {
    return 30000;
  }
  if (!Number.isFinite(deadline)) {
    return SAMPLING_TIMEOUT_MS;
  }
  return Math.min(SAMPLING_TIMEOUT_MS, Math.max(0, (deadline as number) - Date.now()));
}

export function withSamplingTimeout<T>(operation: SamplingOperation<T>): Promise<T> {
  const context = getRequestContext();
  const abortSignal = context?.abortSignal;
  const effectiveTimeout = getEffectiveSamplingTimeout(context?.deadline);
  const execute = typeof operation === 'function' ? operation : () => operation;

  if (abortSignal?.aborted) {
    return Promise.reject(
      createRequestAbortError(abortSignal.reason, 'Sampling request cancelled by client')
    );
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      abortSignal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => {
      settle(() =>
        reject(createRequestAbortError(abortSignal?.reason, 'Sampling request cancelled by client'))
      );
    };

    abortSignal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      settle(() => reject(new Error(`Sampling request timed out after ${effectiveTimeout}ms`)));
    }, effectiveTimeout);

    Promise.resolve()
      .then(() => execute())
      .then(
        (value) => {
          settle(() => resolve(value));
        },
        (error) => {
          settle(() => reject(error));
        }
      );
  });
}

export async function assertSamplingConsent(): Promise<void> {
  if (_consentChecker) {
    await _consentChecker();
    return;
  }
  await assertGlobalSamplingConsent();
}

export function createUserMessage(text: string): SamplingMessage {
  return {
    role: 'user',
    content: { type: 'text', text },
  };
}

export function extractTextFromResult(result: SamplingCreateMessageResult): string {
  const content = Array.isArray(result.content) ? result.content : [result.content];
  return content
    .filter((block): block is { type: string; text?: string } => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

export function getModelHint(operationType: string): {
  hints: Array<{ name: string }>;
  temperature: number;
} {
  if (operationType === 'agentPlanning') {
    return {
      hints: [{ name: 'claude-sonnet-4-latest' }],
      temperature: 0.2,
    };
  }
  return {
    hints: [{ name: 'claude-3-5-haiku-latest' }],
    temperature: 0.3,
  };
}
