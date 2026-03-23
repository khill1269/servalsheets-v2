/**
 * MCP Tool Registration — All-tools-always test
 *
 * Verifies that all 25 tools are always registered regardless of env vars.
 * The legacy SERVAL_TOOL_MODE (lite/standard/full) has been removed.
 * Payload size is managed by DEFER_DESCRIPTIONS + DEFER_SCHEMAS (auto-on
 * for STDIO), not by hiding tools.
 *
 * MCP 2025-11-25: notifications/tools/list_changed + resources/subscribe
 * handle dynamic updates — no static tool-hiding required.
 */

import { register } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ListToolsResponse = {
  tools: Array<{ name: string }>;
};

async function requestHandler(
  server: { server: { server: { _requestHandlers?: Map<string, unknown> } } },
  method: string,
  params: object
) {
  const handler = server.server.server._requestHandlers?.get(method);
  if (!handler) {
    throw new Error(`${method} handler not registered`);
  }
  return (handler as (req: object, ctx: object) => Promise<unknown>)(
    { method, params },
    { sessionId: 'test' }
  );
}

describe('tool-mode MCP registration', () => {
  afterEach(() => {
    try {
      register.clear();
    } catch {
      // prom-client may already be cleared in some test contexts
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('registers all tools in stdio server mode (no mode gating)', async () => {
    // Ensure no legacy mode env var is set
    vi.unstubAllEnvs();
    vi.resetModules();
    register.clear();

    const [{ ServalSheetsServer }, { TOOL_DEFINITIONS }] = await Promise.all([
      import('../../src/server.js'),
      import('../../src/mcp/registration/tool-definitions.js'),
    ]);

    const server = new ServalSheetsServer({
      name: 'ServalSheets All-Tools Test',
      version: '1.0.0-test',
    });

    try {
      await server.initialize();

      const toolsList = (await requestHandler(
        server as unknown as { server: { server: { _requestHandlers?: Map<string, unknown> } } },
        'tools/list',
        {}
      )) as ListToolsResponse;

      const registeredNames = toolsList.tools.map((t) => t.name).sort();
      const expectedNames = [...TOOL_DEFINITIONS].map((t) => t.name).sort();

      // All tools must be registered — no mode-based hiding
      expect(registeredNames).toEqual(expectedNames);
      expect(registeredNames.length).toBeGreaterThanOrEqual(25);
    } finally {
      await server.shutdown();
    }
  });

  it('completion/complete returns all tool names for toolName argument', async () => {
    vi.resetModules();
    register.clear();

    const [{ ServalSheetsServer }, { TOOL_DEFINITIONS }] = await Promise.all([
      import('../../src/server.js'),
      import('../../src/mcp/registration/tool-definitions.js'),
    ]);

    const server = new ServalSheetsServer({
      name: 'ServalSheets Completion Test',
      version: '1.0.0-test',
    });

    try {
      await server.initialize();

      const completion = (await requestHandler(
        server as unknown as { server: { server: { _requestHandlers?: Map<string, unknown> } } },
        'completion/complete',
        {
          ref: {
            type: 'ref/resource',
            uri: 'sheets://tools/{toolName}/actions/{action}',
          },
          argument: {
            name: 'toolName',
            value: 'sheets_',
          },
        }
      )) as { completion: { values: string[] } };

      const completionNames = completion.completion.values.sort();
      const expectedNames = [...TOOL_DEFINITIONS].map((t) => t.name).sort();

      expect(completionNames).toEqual(expectedNames);
    } finally {
      await server.shutdown();
    }
  });
});
