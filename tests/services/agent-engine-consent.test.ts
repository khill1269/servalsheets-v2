import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllPlans,
  compilePlanAI,
  setAgentSamplingConsentChecker,
  setAgentSamplingServer,
  type SamplingServer,
} from '../../src/services/agent-engine.js';
import {
  clearSamplingConsentCache,
  registerSamplingConsentChecker,
} from '../../src/mcp/sampling.js';

describe('agent engine consent fallback', () => {
  afterEach(async () => {
    setAgentSamplingServer(undefined);
    setAgentSamplingConsentChecker(undefined);
    registerSamplingConsentChecker(async () => {});
    clearSamplingConsentCache();
    await clearAllPlans();
    vi.restoreAllMocks();
  });

  it('uses global sampling consent guard when local agent consent checker is not set', async () => {
    registerSamplingConsentChecker(async () => {
      throw new Error('GDPR_CONSENT_REQUIRED');
    });
    setAgentSamplingConsentChecker(undefined);

    const createMessage = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '[]' }],
    });
    const server: SamplingServer = {
      createMessage: createMessage as SamplingServer['createMessage'],
    };
    setAgentSamplingServer(server);

    const plan = await compilePlanAI('analyze monthly sales trends', 5, 'sheet-123');

    expect(plan.steps.length).toBeGreaterThan(0);
    expect(createMessage).not.toHaveBeenCalled();
  });
});
