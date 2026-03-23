import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '../helpers/wait-for.js';

const createMockServer = (): McpServer =>
  ({
    sendToolListChanged: vi.fn(),
    server: {
      setRequestHandler: vi.fn(),
    },
    setLoggingLevel: vi.fn(),
    request: vi.fn(),
    notification: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  }) as unknown as McpServer;

describe('ToolStageManager', () => {
  afterEach(() => {
    register.clear();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('advancing stages clears discovery hints and emits tools/list_changed', async () => {
    vi.stubEnv('SERVAL_STAGED_REGISTRATION', 'true');
    register.clear();
    vi.resetModules();

    const discoveryHints = await import('../../src/mcp/registration/tool-discovery-hints.js');
    const { resourceNotifications } = await import('../../src/resources/notifications.js');

    const clearSpy = vi.spyOn(discoveryHints, 'clearDiscoveryHintCache');
    const [{ ToolStageManager }, { TOOL_DEFINITIONS }] = await Promise.all([
      import('../../src/mcp/registration/tool-stage-manager.js'),
      import('../../src/mcp/registration/tool-definitions.js'),
    ]);
    const server = createMockServer();
    resourceNotifications.setServer(server);

    try {
      const manager = new ToolStageManager();
      const registerCallback = vi.fn();
      manager.initialize(TOOL_DEFINITIONS, registerCallback);

      const initialTools = manager.getInitialTools();
      manager.markRegistered(initialTools.map((tool) => tool.name));

      const newTools = manager.advanceToStage(2);

      expect(newTools.length).toBeGreaterThan(0);
      expect(registerCallback).toHaveBeenCalledOnce();
      expect(clearSpy).toHaveBeenCalledOnce();

      await waitFor(100);

      expect(server.sendToolListChanged).toHaveBeenCalledOnce();
    } finally {
      resourceNotifications.unregisterServer(server);
    }
  });
});
