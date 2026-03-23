import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageWithFallback } from '../../src/services/llm-fallback.js';
import { buildToolResponse } from '../../src/mcp/registration/tool-response.js';
import { createRequestContext, runWithRequestContext } from '../../src/utils/request-context.js';

describe('LLM provenance response metadata', () => {
  const originalApiKey = process.env['LLM_API_KEY'];
  const originalProvider = process.env['LLM_PROVIDER'];
  const originalModel = process.env['LLM_MODEL'];

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env['LLM_API_KEY'];
    } else {
      process.env['LLM_API_KEY'] = originalApiKey;
    }
    if (originalProvider === undefined) {
      delete process.env['LLM_PROVIDER'];
    } else {
      process.env['LLM_PROVIDER'] = originalProvider;
    }
    if (originalModel === undefined) {
      delete process.env['LLM_MODEL'];
    } else {
      process.env['LLM_MODEL'] = originalModel;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces MCP sampling provenance in tool-response _meta', async () => {
    const result = await runWithRequestContext(createRequestContext({ requestId: 'sampling-req' }), async () => {
      const llmResponse = await createMessageWithFallback(
        {
          getClientCapabilities: () => ({ sampling: {} }),
          createMessage: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'sampled-response' }],
            model: 'claude-sonnet-4',
          }),
        },
        {
          messages: [{ role: 'user', content: 'hello' }],
        }
      );

      expect(llmResponse.mode).toBe('sampling');
      expect(llmResponse.provider).toBe('mcp');

      return buildToolResponse({
        response: {
          success: true,
          action: 'suggest_chart',
        },
      });
    });

    expect((result.structuredContent as any)._meta.aiMode).toBe('sampling');
    expect((result.structuredContent as any)._meta.aiProvider).toBe('mcp');
    expect((result.structuredContent as any)._meta.aiModelUsed).toBe('claude-sonnet-4');
  });

  it('surfaces direct fallback provenance in tool-response _meta', async () => {
    process.env['LLM_API_KEY'] = 'test-api-key';
    process.env['LLM_PROVIDER'] = 'anthropic';
    process.env['LLM_MODEL'] = 'claude-fallback-test';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'fallback-response' }],
          model: 'claude-fallback-test',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        }),
      })
    );

    const result = await runWithRequestContext(createRequestContext({ requestId: 'fallback-req' }), async () => {
      const llmResponse = await createMessageWithFallback(
        null,
        {
          messages: [{ role: 'user', content: 'hello' }],
        }
      );

      expect(llmResponse.mode).toBe('fallback');
      expect(llmResponse.provider).toBe('anthropic');

      return buildToolResponse({
        response: {
          success: true,
          action: 'suggest_pivot',
        },
      });
    });

    expect((result.structuredContent as any)._meta.aiMode).toBe('fallback');
    expect((result.structuredContent as any)._meta.aiProvider).toBe('anthropic');
    expect((result.structuredContent as any)._meta.aiModelUsed).toBe('claude-fallback-test');
  });
});
