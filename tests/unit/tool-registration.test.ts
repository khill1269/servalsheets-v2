import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { resetEnvForTest } from '../../src/config/env.js';
import type { AuthHandler } from '../../src/handlers/auth.js';
import type { ToolDefinition } from '../../src/mcp/registration/tool-definitions.js';
import {
  assertValidToolDefinitionNames,
  createPreAuthToolHandlerMap,
  registerActiveTools,
  type ToolExecutionHandler,
} from '../../src/mcp/registration/tool-registration.js';
import { resetSessionContext } from '../../src/services/session-context.js';

function createMockServer() {
  const registeredTools: Record<string, unknown> = {};

  const server = {
    server: {
      setRequestHandler: vi.fn(),
      getClientCapabilities: vi.fn(() => ({ sampling: {} })),
      createMessage: vi.fn().mockResolvedValue({
        model: 'mock-sampling-model',
        role: 'assistant',
        content: {
          type: 'text',
          text: JSON.stringify({
            title: 'Generated Budget Planner',
            sheets: [
              {
                name: 'Budget',
                columns: [{ header: 'Category', type: 'text', width: 160 }],
                rows: [{ values: ['Marketing'] }],
                formatting: { freezeRows: 1 },
              },
            ],
          }),
        },
      }),
    },
    experimental: {
      tasks: {
        registerToolTask: vi.fn((name: string, config: Record<string, unknown>) => {
          registeredTools[name] = { ...config, mode: 'task' };
        }),
      },
    },
    registerTool: vi.fn((name: string, config: Record<string, unknown>, cb: unknown) => {
      registeredTools[name] = { ...config, cb, mode: 'tool' };
    }),
  } as unknown as McpServer;

  return { server, registeredTools };
}

describe('tool registration helpers', () => {
  afterEach(() => {
    resetEnvForTest();
    resetSessionContext();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('builds a pre-auth handler map that serves session actions locally', async () => {
    const { server } = createMockServer();
    const authHandler = {
      handle: vi.fn().mockResolvedValue({ response: { success: true, action: 'status' } }),
    } as unknown as AuthHandler;

    const handlerMap = createPreAuthToolHandlerMap({ server, authHandler });

    expect(Object.keys(handlerMap).sort()).toEqual([
      'sheets_auth',
      'sheets_composite',
      'sheets_confirm',
      'sheets_session',
    ]);

    const sessionResult = await handlerMap['sheets_session']({
      request: { action: 'get_active' },
    });

    expect(sessionResult).toMatchObject({
      response: {
        success: true,
        action: 'get_active',
      },
    });

    const previewResult = await handlerMap['sheets_composite']({
      request: {
        action: 'preview_generation',
        description: 'Create a department budget tracker',
      },
    });

    expect(previewResult).toMatchObject({
      response: {
        success: true,
        action: 'preview_generation',
      },
    });
  });

  it('accepts MCP-compliant tool names beyond snake_case', () => {
    expect(() =>
      assertValidToolDefinitionNames([{ name: 'Sheets-Core_2' }] as readonly Pick<
        ToolDefinition,
        'name'
      >[])
    ).not.toThrow();
  });

  it('rejects tool names outside the MCP character set', () => {
    expect(() =>
      assertValidToolDefinitionNames([{ name: 'Sheets Core!' }] as readonly Pick<
        ToolDefinition,
        'name'
      >[])
    ).toThrow(/letters, numbers, hyphens, and underscores/i);
  });

  it('rejects tool names longer than 64 characters', () => {
    expect(() =>
      assertValidToolDefinitionNames([{ name: 's'.repeat(65) }] as readonly Pick<
        ToolDefinition,
        'name'
      >[])
    ).toThrow(/maximum length of 64 characters/i);
  });

  it('registers task-capable tools via tasks and auth-only tools via registerTool', () => {
    vi.stubEnv('ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS', 'false');
    const { server, registeredTools } = createMockServer();
    const tools = [
      {
        name: 'sheets_auth',
        title: 'Authentication',
        description: 'Authenticate',
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        annotations: { title: 'Authentication' },
      },
      {
        name: 'sheets_data',
        title: 'Data',
        description: 'Read and write',
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        annotations: { title: 'Data' },
      },
    ] as const satisfies readonly ToolDefinition[];

    const createRunTool = vi.fn<ToolExecutionHandler, [ToolDefinition]>(() =>
      vi.fn(async () => ({
        content: [],
        structuredContent: {},
      }))
    );
    const createTaskHandler = vi.fn<ToolTaskHandler<AnySchema>, [string, ToolExecutionHandler]>(
      () => ({
        createTask: vi.fn(),
        getTask: vi.fn(),
        getTaskResult: vi.fn(),
      })
    );

    registerActiveTools({
      server,
      tools,
      createRunTool,
      createTaskHandler,
    });

    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.experimental.tasks.registerToolTask).toHaveBeenCalledTimes(1);
    expect(createRunTool).toHaveBeenCalledTimes(2);
    expect(createTaskHandler).toHaveBeenCalledTimes(1);
    expect(registeredTools['sheets_auth']).toMatchObject({ mode: 'tool' });
    expect(registeredTools['sheets_data']).toMatchObject({ mode: 'task' });
  });
});
