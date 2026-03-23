import { describe, expect, it, vi } from 'vitest';
import { createTaskAwareSamplingServer } from '../../src/mcp/sampling.js';
import { createRequestContext, runWithRequestContext } from '../../src/utils/request-context.js';

describe('createTaskAwareSamplingServer', () => {
  it('uses the base sampling server for active requests', async () => {
    const baseServer = {
      getClientCapabilities: vi.fn(() => ({ sampling: {} })),
      createMessage: vi.fn().mockResolvedValue({
        model: 'mock-model',
        role: 'assistant',
        content: { type: 'text', text: 'sampled-response' },
      }),
    };
    const sendRequest = vi.fn();
    const result = await runWithRequestContext(
      createRequestContext({
        sendRequest,
      }),
      async () =>
        await createTaskAwareSamplingServer(baseServer).createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
        })
    );

    expect(sendRequest).not.toHaveBeenCalled();
    expect(baseServer.createMessage).toHaveBeenCalledWith(
      {
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      },
      {
        signal: undefined,
      }
    );
    expect(result).toMatchObject({
      model: 'mock-model',
      role: 'assistant',
    });
  });

  it('marks tasks input_required before delegating sampling to the base server', async () => {
    const baseServer = {
      getClientCapabilities: vi.fn(() => ({ sampling: {} })),
      createMessage: vi.fn().mockResolvedValue({
        model: 'mock-model',
        role: 'assistant',
        content: { type: 'text', text: 'sampled-response' },
      }),
    };
    const taskStore = {
      updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    };
    const server = createTaskAwareSamplingServer(baseServer);

    await runWithRequestContext(
      createRequestContext({
        sendRequest: vi.fn(),
        taskId: 'task-123',
        taskStore,
      }),
      async () =>
        await server.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
        })
    );

    expect(taskStore.updateTaskStatus).toHaveBeenCalledWith('task-123', 'input_required');
    expect(baseServer.createMessage).toHaveBeenCalledWith(
      {
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      },
      {
        signal: undefined,
      }
    );
  });
});
