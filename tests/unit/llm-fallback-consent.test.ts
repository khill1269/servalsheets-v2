import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageWithFallback } from '../../src/services/llm-fallback.js';
import {
  clearSamplingConsentCache,
  registerSamplingConsentChecker,
} from '../../src/mcp/sampling.js';

describe('createMessageWithFallback consent guard', () => {
  afterEach(() => {
    clearSamplingConsentCache();
    registerSamplingConsentChecker(async () => {});
    vi.restoreAllMocks();
  });

  it('rejects MCP sampling path when consent checker denies access', async () => {
    registerSamplingConsentChecker(async () => {
      throw new Error('GDPR_CONSENT_REQUIRED');
    });

    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'should-not-run' }],
    });

    await expect(
      createMessageWithFallback(
        {
          getClientCapabilities: () => ({ sampling: {} }),
          createMessage,
        },
        {
          messages: [{ role: 'user', content: 'hello' }],
        }
      )
    ).rejects.toThrow('GDPR_CONSENT_REQUIRED');

    expect(createMessage).not.toHaveBeenCalled();
  });

  it('allows MCP sampling path when consent checker passes', async () => {
    registerSamplingConsentChecker(async () => {});

    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'sampled-response' }],
      model: 'mock-model',
    });

    const result = await createMessageWithFallback(
      {
        getClientCapabilities: () => ({ sampling: {} }),
        createMessage,
      },
      {
        messages: [{ role: 'user', content: 'hello' }],
      }
    );

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('sampled-response');
    expect(result.model).toBe('mock-model');
  });
});
