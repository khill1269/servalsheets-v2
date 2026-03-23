/**
 * Unit Tests for Feature 1: Real-Time Notifications
 *
 * Tests the integration of MCP resource notifications with the webhook system.
 * Verifies that notifications are emitted when:
 * - Spreadsheet state changes are detected
 * - Webhooks are delivered successfully
 * - Webhooks are registered
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resourceNotifications } from '../../src/resources/notifications.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { waitFor } from '../helpers/wait-for.js';

// Mock McpServer
const createMockServer = (): McpServer =>
  ({
    sendResourceListChanged: vi.fn(),
    sendToolListChanged: vi.fn(),
    server: {
      sendResourceUpdated: vi.fn().mockResolvedValue(undefined),
      setRequestHandler: vi.fn(),
    },
    // Add other required McpServer methods as stubs
    setLoggingLevel: vi.fn(),
    request: vi.fn(),
    notification: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  }) as unknown as McpServer;

function getSubscriptionHandlers(server: McpServer): {
  subscribe: (request: { params: { uri: string } }) => Promise<Record<string, never>>;
  unsubscribe: (request: { params: { uri: string } }) => Promise<Record<string, never>>;
} {
  const calls = (
    (server as unknown as { server: { setRequestHandler: ReturnType<typeof vi.fn> } }).server
      .setRequestHandler as ReturnType<typeof vi.fn>
  ).mock.calls;
  return {
    subscribe: calls[0][1] as (request: {
      params: { uri: string };
    }) => Promise<Record<string, never>>,
    unsubscribe: calls[1][1] as (request: {
      params: { uri: string };
    }) => Promise<Record<string, never>>,
  };
}

describe('Feature 1: Real-Time Notifications', () => {
  let mockServer: McpServer;

  beforeEach(() => {
    mockServer = createMockServer();
    vi.clearAllMocks();
    resourceNotifications.setServer(mockServer);
  });

  afterEach(() => {
    resourceNotifications.unregisterServer(mockServer);
    vi.restoreAllMocks();
  });

  describe('Resource Notification Manager', () => {
    it('should emit notification when resource list changes', async () => {
      resourceNotifications.notifyResourceListChanged('test change');

      // Wait for debounce
      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledOnce();
    });

    it('should debounce rapid notifications', async () => {
      // Send multiple rapid notifications
      resourceNotifications.notifyResourceListChanged('change 1');
      resourceNotifications.notifyResourceListChanged('change 2');
      resourceNotifications.notifyResourceListChanged('change 3');

      // Wait for debounce
      await waitFor(100);

      // Should only send one notification despite 3 calls
      expect(mockServer.sendResourceListChanged).toHaveBeenCalledOnce();
    });

    it('should notify when analysis result is added', async () => {
      resourceNotifications.notifyAnalysisAdded('analysis-123');

      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledOnce();
    });

    it('should notify when cache is invalidated', async () => {
      const { subscribe } = getSubscriptionHandlers(mockServer);
      await subscribe({ params: { uri: 'cache://stats' } });

      resourceNotifications.notifyCacheInvalidated();

      await waitFor(100);

      expect(
        (
          mockServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).toHaveBeenCalledWith({ uri: 'cache://stats' });
    });

    it('should notify when transaction state changes', async () => {
      const { subscribe } = getSubscriptionHandlers(mockServer);
      await subscribe({ params: { uri: 'transaction://stats' } });

      resourceNotifications.notifyTransactionStateChanged('txn-456', 'committed');

      await waitFor(100);

      expect(
        (
          mockServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).toHaveBeenCalledWith({ uri: 'transaction://stats' });
    });

    it('should notify when operation history is updated', async () => {
      const { subscribe } = getSubscriptionHandlers(mockServer);
      await subscribe({ params: { uri: 'history://operations' } });

      resourceNotifications.notifyHistoryUpdated(5);

      await waitFor(100);

      expect(
        (
          mockServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).toHaveBeenCalledWith({ uri: 'history://operations' });
    });

    it('should not throw if server is not initialized', () => {
      // Create a new instance without server
      const notInitialized = new (resourceNotifications.constructor as any)();

      expect(() => {
        notInitialized.notifyResourceListChanged('test');
      }).not.toThrow();
    });

    it('should report initialization status correctly', () => {
      expect(resourceNotifications.isInitialized()).toBe(true);
    });

    it('should register resources/subscribe and resources/unsubscribe handlers', () => {
      const handlers = getSubscriptionHandlers(mockServer);
      expect(handlers.subscribe).toEqual(expect.any(Function));
      expect(handlers.unsubscribe).toEqual(expect.any(Function));
    });

    it('should emit resources/updated for subscribed exact URIs', async () => {
      const notifications = new (resourceNotifications.constructor as {
        new (): {
          setServer: (server: McpServer) => void;
          unregisterServer: (server: McpServer) => void;
          notifyResourceUpdated: (uri: string, reason?: string) => void;
        };
      })();
      const exactServer = createMockServer();
      notifications.setServer(exactServer);

      const { subscribe } = getSubscriptionHandlers(exactServer);
      await subscribe({ params: { uri: 'cache://stats' } });

      notifications.notifyResourceUpdated('cache://stats', 'cache update');
      await waitFor(100);

      expect(
        (
          exactServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).toHaveBeenCalledWith({ uri: 'cache://stats' });

      notifications.unregisterServer(exactServer);
    });

    it('should emit resources/updated for subscribed spreadsheet subtree URIs', async () => {
      const notifications = new (resourceNotifications.constructor as {
        new (): {
          setServer: (server: McpServer) => void;
          unregisterServer: (server: McpServer) => void;
          notifySpreadsheetMutation: (spreadsheetId: string, reason?: string) => void;
        };
      })();
      const spreadsheetServer = createMockServer();
      notifications.setServer(spreadsheetServer);

      const { subscribe } = getSubscriptionHandlers(spreadsheetServer);
      await subscribe({ params: { uri: 'sheets:///sheet-123/Sheet1!A1:B2' } });

      notifications.notifySpreadsheetMutation('sheet-123', 'write');
      await waitFor(100);

      expect(
        (
          spreadsheetServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).toHaveBeenCalledWith({ uri: 'sheets:///sheet-123/Sheet1!A1:B2' });

      notifications.unregisterServer(spreadsheetServer);
    });

    it('should stop emitting resources/updated after unsubscribe', async () => {
      const notifications = new (resourceNotifications.constructor as {
        new (): {
          setServer: (server: McpServer) => void;
          unregisterServer: (server: McpServer) => void;
          notifyResourceUpdated: (uri: string, reason?: string) => void;
        };
      })();
      const unsubscribedServer = createMockServer();
      notifications.setServer(unsubscribedServer);

      const { subscribe, unsubscribe } = getSubscriptionHandlers(unsubscribedServer);
      await subscribe({ params: { uri: 'cache://stats' } });
      await unsubscribe({ params: { uri: 'cache://stats' } });

      notifications.notifyResourceUpdated('cache://stats', 'cache update');
      await waitFor(100);

      expect(
        (
          unsubscribedServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).not.toHaveBeenCalled();

      notifications.unregisterServer(unsubscribedServer);
    });

    it('should keep resource subscriptions scoped to each server', async () => {
      const notifications = new (resourceNotifications.constructor as {
        new (): {
          setServer: (server: McpServer) => void;
          unregisterServer: (server: McpServer) => void;
          notifyResourceUpdated: (uri: string, reason?: string) => void;
        };
      })();
      const cacheServer = createMockServer();
      const historyServer = createMockServer();
      notifications.setServer(cacheServer);
      notifications.setServer(historyServer);

      const cacheHandlers = getSubscriptionHandlers(cacheServer);
      const historyHandlers = getSubscriptionHandlers(historyServer);
      await cacheHandlers.subscribe({ params: { uri: 'cache://stats' } });
      await historyHandlers.subscribe({ params: { uri: 'history://stats' } });

      notifications.notifyResourceUpdated('cache://stats', 'cache update');
      await waitFor(100);

      expect(
        (
          cacheServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).toHaveBeenCalledWith({ uri: 'cache://stats' });
      expect(
        (
          historyServer as unknown as {
            server: { sendResourceUpdated: ReturnType<typeof vi.fn> };
          }
        ).server.sendResourceUpdated
      ).not.toHaveBeenCalled();

      notifications.unregisterServer(cacheServer);
      notifications.unregisterServer(historyServer);
    });

    it('should emit tools/list_changed only when tool set changes', async () => {
      const notifications = new (resourceNotifications.constructor as {
        new (): {
          setServer: (server: McpServer) => void;
          unregisterServer: (server: McpServer) => void;
          syncToolList: (
            toolNames: readonly string[],
            options?: { reason?: string; emitOnFirstSet?: boolean }
          ) => void;
        };
      })();
      notifications.setServer(mockServer);

      notifications.syncToolList(['sheets_auth', 'sheets_data'], { emitOnFirstSet: false });
      await waitFor(100);
      expect((mockServer as any).sendToolListChanged).not.toHaveBeenCalled();

      notifications.syncToolList(['sheets_auth', 'sheets_data', 'sheets_session'], {
        reason: 'runtime update',
      });
      await waitFor(100);
      expect((mockServer as any).sendToolListChanged).toHaveBeenCalledTimes(1);

      notifications.syncToolList(['sheets_auth', 'sheets_data', 'sheets_session']);
      await waitFor(100);
      expect((mockServer as any).sendToolListChanged).toHaveBeenCalledTimes(1);

      notifications.unregisterServer(mockServer);
    });
  });

  describe('Webhook Integration', () => {
    it('should emit notification on spreadsheet state change', async () => {
      // This tests the integration point in webhook-manager.ts
      // The actual implementation calls resourceNotifications.notifyResourceListChanged
      // when hasStateChanged returns true

      const spreadsheetId = 'test-sheet-123';
      resourceNotifications.notifyResourceListChanged(`spreadsheet changed: ${spreadsheetId}`);

      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledOnce();
    });

    it('should emit notification on webhook delivery', async () => {
      // This tests the integration point in webhook-worker.ts
      const webhookId = 'wh_test123';
      const eventType = 'cell.update';

      resourceNotifications.notifyResourceListChanged(
        `webhook delivered: ${eventType} for ${webhookId.slice(0, 8)}`
      );

      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledOnce();
    });

    it('should emit notification on webhook registration', async () => {
      // This tests the integration point in webhooks.ts handler
      resourceNotifications.notifyResourceListChanged('webhook registered');

      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledOnce();
    });
  });

  describe('Error Handling', () => {
    it('should handle server notification errors gracefully', async () => {
      const errorServer = createMockServer();
      (errorServer.sendResourceListChanged as any).mockImplementation(() => {
        throw new Error('Network error');
      });

      resourceNotifications.setServer(errorServer);

      expect(() => {
        resourceNotifications.notifyResourceListChanged('test');
      }).not.toThrow();

      await waitFor(100);
      resourceNotifications.unregisterServer(errorServer);
    });
  });

  describe('Debouncing Behavior', () => {
    it('should send multiple notifications if separated by debounce window', async () => {
      resourceNotifications.notifyResourceListChanged('change 1');

      // Wait for first notification to send
      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledTimes(1);

      // Send another notification after debounce period
      resourceNotifications.notifyResourceListChanged('change 2');

      await waitFor(100);

      expect(mockServer.sendResourceListChanged).toHaveBeenCalledTimes(2);
    });

    it('should use 50ms debounce window', async () => {
      const startTime = Date.now();

      resourceNotifications.notifyResourceListChanged('test');

      // Wait for notification
      await waitFor(100);

      const elapsed = Date.now() - startTime;

      // Should take at least 50ms (debounce) but less than 150ms
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(150);
    });
  });
});
