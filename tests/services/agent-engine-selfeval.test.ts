/**
 * Tests for aiValidateStepResult — AI reflexion validation (IMP-03).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiValidateStepResult,
  setAgentSamplingServer,
  setAgentSamplingConsentChecker,
  type ExecutionStep,
  type SamplingServer,
} from '../../src/services/agent-engine.js';
import {
  clearSamplingConsentCache,
  registerSamplingConsentChecker,
} from '../../src/mcp/sampling.js';

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    stepId: 'step-1',
    tool: 'sheets_data',
    action: 'read',
    params: { spreadsheetId: 'abc', range: 'Sheet1!A1:B5' },
    description: 'Read data from sheet',
    ...overrides,
  };
}

describe('aiValidateStepResult', () => {
  afterEach(() => {
    setAgentSamplingServer(undefined);
    setAgentSamplingConsentChecker(undefined);
    registerSamplingConsentChecker(async () => {});
    clearSamplingConsentCache();
    vi.restoreAllMocks();
  });

  it('returns valid:true when sampling server is undefined', async () => {
    setAgentSamplingServer(undefined);

    const result = await aiValidateStepResult(makeStep(), { success: true });

    expect(result).toEqual({ valid: true });
  });

  it('returns validation issue when sampling reports failure', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: 'text', text: '{"valid": false, "issue": "test issue", "suggestedFix": "retry"}' },
    });
    const server: SamplingServer = {
      createMessage: createMessage as SamplingServer['createMessage'],
    };
    setAgentSamplingServer(server);
    setAgentSamplingConsentChecker(async () => {});

    const result = await aiValidateStepResult(makeStep(), { success: true, data: [1, 2, 3] });

    expect(result.valid).toBe(false);
    expect(result.issue).toBe('test issue');
    expect(result.suggestedFix).toBe('retry');
    expect(createMessage).toHaveBeenCalledOnce();
  });

  it('returns valid:true when sampling returns valid result', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: 'text', text: '{"valid": true}' },
    });
    const server: SamplingServer = {
      createMessage: createMessage as SamplingServer['createMessage'],
    };
    setAgentSamplingServer(server);
    setAgentSamplingConsentChecker(async () => {});

    const result = await aiValidateStepResult(makeStep(), { success: true });

    expect(result.valid).toBe(true);
    expect(result.issue).toBeUndefined();
  });

  it('returns valid:true when sampling throws (fail open)', async () => {
    const createMessage = vi.fn().mockRejectedValue(new Error('network error'));
    const server: SamplingServer = {
      createMessage: createMessage as SamplingServer['createMessage'],
    };
    setAgentSamplingServer(server);
    setAgentSamplingConsentChecker(async () => {});

    const result = await aiValidateStepResult(makeStep(), { success: true });

    expect(result).toEqual({ valid: true });
  });

  it('handles markdown-wrapped JSON response', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: 'text', text: '```json\n{"valid": false, "issue": "wrapped"}\n```' },
    });
    const server: SamplingServer = {
      createMessage: createMessage as SamplingServer['createMessage'],
    };
    setAgentSamplingServer(server);
    setAgentSamplingConsentChecker(async () => {});

    const result = await aiValidateStepResult(makeStep(), { success: true });

    expect(result.valid).toBe(false);
    expect(result.issue).toBe('wrapped');
  });
});
