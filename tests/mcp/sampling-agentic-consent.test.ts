import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSamplingConsentCache,
  registerSamplingConsentChecker,
  streamAgenticOperation,
  type SamplingServer,
} from '../../src/mcp/sampling.js';

describe('sampling agentic consent guard', () => {
  afterEach(() => {
    clearSamplingConsentCache();
    registerSamplingConsentChecker(async () => {});
    vi.restoreAllMocks();
  });

  it('blocks streamAgenticOperation before sampling when consent is denied', async () => {
    registerSamplingConsentChecker(async () => {
      throw new Error('GDPR_CONSENT_REQUIRED');
    });

    const createMessage = vi.fn();
    const server: SamplingServer = {
      getClientCapabilities: () => ({ sampling: { tools: true } }),
      createMessage: createMessage as SamplingServer['createMessage'],
    };

    const stream = streamAgenticOperation(server, 'plan a workflow', 'context', async () => ({
      result: {},
      continue: false,
    }));

    await expect(stream.next()).rejects.toThrow('GDPR_CONSENT_REQUIRED');
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('allows streamAgenticOperation when consent is granted', async () => {
    registerSamplingConsentChecker(async () => {});

    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'agentic response' }],
      model: 'mock-model',
      role: 'assistant',
      stopReason: 'endTurn',
    });
    const server: SamplingServer = {
      getClientCapabilities: () => ({ sampling: { tools: true } }),
      createMessage: createMessage as SamplingServer['createMessage'],
    };

    const stream = streamAgenticOperation(server, 'plan a workflow', 'context', async () => ({
      result: {},
      continue: false,
    }));
    const first = await stream.next();

    expect(first.value).toEqual({ type: 'text', data: 'agentic response' });
    expect(createMessage).toHaveBeenCalledTimes(1);
  });
});
