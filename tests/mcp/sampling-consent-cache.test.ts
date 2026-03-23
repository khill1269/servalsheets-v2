import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSamplingConsent,
  clearSamplingConsentCache,
  registerSamplingConsentChecker,
  withSamplingTimeout,
} from '../../src/mcp/sampling.js';
import { createRequestContext, runWithRequestContext } from '../../src/utils/request-context.js';

async function runAsPrincipal(principalId: string, fn: () => Promise<void>): Promise<void> {
  const context = createRequestContext({ principalId });
  await runWithRequestContext(context, fn);
}

describe('sampling consent cache', () => {
  afterEach(() => {
    clearSamplingConsentCache();
    vi.restoreAllMocks();
  });

  it('reuses consent result for repeated calls by the same principal', async () => {
    const checker = vi.fn(async () => {});
    registerSamplingConsentChecker(checker);

    await runAsPrincipal('user-a', async () => {
      await assertSamplingConsent();
      await assertSamplingConsent();
    });

    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('checks consent separately for different principals', async () => {
    const checker = vi.fn(async () => {});
    registerSamplingConsentChecker(checker);

    await runAsPrincipal('user-a', async () => {
      await assertSamplingConsent();
    });
    await runAsPrincipal('user-b', async () => {
      await assertSamplingConsent();
    });

    expect(checker).toHaveBeenCalledTimes(2);
  });

  it('caches denial result for the same principal within TTL window', async () => {
    const checker = vi.fn(async () => {
      throw new Error('GDPR_CONSENT_REQUIRED');
    });
    registerSamplingConsentChecker(checker);

    await expect(
      runAsPrincipal('user-a', async () => {
        await assertSamplingConsent();
      })
    ).rejects.toThrow('GDPR_CONSENT_REQUIRED');

    await expect(
      runAsPrincipal('user-a', async () => {
        await assertSamplingConsent();
      })
    ).rejects.toThrow('GDPR_CONSENT_REQUIRED');

    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the sampling factory when the request is already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort('Cancelled before sampling request');
    const factory = vi.fn(async () => 'should-not-run');

    const context = createRequestContext({
      principalId: 'user-c',
      abortSignal: abortController.signal,
    });

    await expect(
      runWithRequestContext(context, async () => withSamplingTimeout(factory))
    ).rejects.toMatchObject({
      name: 'AbortError',
      code: 'OPERATION_CANCELLED',
      message: 'Cancelled before sampling request',
    });

    expect(factory).not.toHaveBeenCalled();
  });
});
