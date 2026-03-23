/**
 * ServalSheets - Resource Notifications
 *
 * Provides utilities for notifying clients when resources change.
 * Uses MCP's notifications/resources/list_changed and notifications/resources/updated
 * notifications with session-scoped subscription tracking.
 *
 * @module resources/notifications
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';

interface NotificationServerState {
  notificationsPending: number;
  resourceListDebounceTimer: ReturnType<typeof setTimeout> | null;
  pendingUpdatedUris: Set<string>;
  resourceUpdateDebounceTimer: ReturnType<typeof setTimeout> | null;
  toolListFingerprint: string | null;
  toolDebounceTimer: ReturnType<typeof setTimeout> | null;
  subscribedUris: Set<string>;
}

function createServerState(): NotificationServerState {
  return {
    notificationsPending: 0,
    resourceListDebounceTimer: null,
    pendingUpdatedUris: new Set<string>(),
    resourceUpdateDebounceTimer: null,
    toolListFingerprint: null,
    toolDebounceTimer: null,
    subscribedUris: new Set<string>(),
  };
}

function normalizeResourceIdentity(uri: string): string {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    const [withoutQuery] = uri.split('?');
    return withoutQuery ?? uri;
  }
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Manager for MCP resource change notifications.
 * Tracks subscriptions per connected server/session so HTTP sessions remain isolated.
 */
class ResourceNotificationManager {
  private readonly _debounceMs = 50; // Debounce rapid changes
  private readonly _servers = new Map<McpServer, NotificationServerState>();

  /**
   * Register an MCP server instance for sending notifications.
   */
  setServer(server: McpServer): void {
    if (this._servers.has(server)) {
      return;
    }

    this._servers.set(server, createServerState());
    this.registerSubscriptionHandlers(server);
    logger.info('Resource notification manager initialized', {
      sessionsTracked: this._servers.size,
    });
  }

  /**
   * Remove an MCP server instance and clear any pending timers/subscriptions.
   */
  unregisterServer(server: McpServer): void {
    const state = this._servers.get(server);
    if (!state) {
      return;
    }

    if (state.resourceListDebounceTimer) {
      clearTimeout(state.resourceListDebounceTimer);
    }
    if (state.resourceUpdateDebounceTimer) {
      clearTimeout(state.resourceUpdateDebounceTimer);
    }
    if (state.toolDebounceTimer) {
      clearTimeout(state.toolDebounceTimer);
    }

    this._servers.delete(server);
    logger.info('Resource notification manager unregistered server', {
      sessionsTracked: this._servers.size,
    });
  }

  private getOrCreateState(server: McpServer): NotificationServerState {
    const existing = this._servers.get(server);
    if (existing) {
      return existing;
    }

    const created = createServerState();
    this._servers.set(server, created);
    return created;
  }

  private registerSubscriptionHandlers(server: McpServer): void {
    server.server.setRequestHandler(
      SubscribeRequestSchema,
      async (request: { params: { uri: string } }) => {
        const state = this.getOrCreateState(server);
        state.subscribedUris.add(request.params.uri);
        logger.debug('Registered MCP resource subscription', {
          uri: request.params.uri,
          subscriptionCount: state.subscribedUris.size,
        });
        return {};
      }
    );

    server.server.setRequestHandler(
      UnsubscribeRequestSchema,
      async (request: { params: { uri: string } }) => {
        const state = this.getOrCreateState(server);
        state.subscribedUris.delete(request.params.uri);
        logger.debug('Removed MCP resource subscription', {
          uri: request.params.uri,
          subscriptionCount: state.subscribedUris.size,
        });
        return {};
      }
    );
  }

  private flushUpdatedUris(server: McpServer, state: NotificationServerState): void {
    if (state.pendingUpdatedUris.size === 0) {
      state.resourceUpdateDebounceTimer = null;
      return;
    }

    const uris = [...state.pendingUpdatedUris];
    state.pendingUpdatedUris.clear();
    state.resourceUpdateDebounceTimer = null;

    for (const uri of uris) {
      void server.server.sendResourceUpdated({ uri }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to send resources/updated notification', {
          uri,
          error: message,
        });
      });
    }
  }

  private queueMatchedResourceUpdates(
    matcher: (subscribedUri: string) => boolean,
    reason?: string
  ): void {
    for (const [server, state] of this._servers.entries()) {
      let queued = 0;
      for (const subscribedUri of state.subscribedUris) {
        if (!matcher(subscribedUri)) {
          continue;
        }
        state.pendingUpdatedUris.add(subscribedUri);
        queued++;
      }

      if (queued === 0) {
        continue;
      }

      if (state.resourceUpdateDebounceTimer) {
        clearTimeout(state.resourceUpdateDebounceTimer);
      }

      state.resourceUpdateDebounceTimer = setTimeout(() => {
        this.flushUpdatedUris(server, state);
      }, this._debounceMs);

      if (reason) {
        logger.debug('Queued resources/updated notification(s)', {
          reason,
          count: queued,
        });
      }
    }
  }

  /**
   * Send a resource list changed notification to the client.
   * Debounces rapid changes to avoid flooding.
   */
  notifyResourceListChanged(reason?: string): void {
    for (const [server, state] of this._servers.entries()) {
      state.notificationsPending++;

      if (state.resourceListDebounceTimer) {
        clearTimeout(state.resourceListDebounceTimer);
      }

      state.resourceListDebounceTimer = setTimeout(() => {
        try {
          server.sendResourceListChanged();
          if (reason) {
            logger.debug('Resource list changed notification sent', { reason });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('Failed to send resource notification', { error: message });
        }

        state.notificationsPending = 0;
        state.resourceListDebounceTimer = null;
      }, this._debounceMs);
    }
  }

  /**
   * Notify subscribers that one or more specific resources changed.
   * Query strings are ignored for matching so canonical resource variants are updated together.
   */
  notifyResourceUpdated(uris: string | readonly string[], reason?: string): void {
    const normalizedTargets = new Set(
      dedupeStrings(Array.isArray(uris) ? uris : [uris]).map(normalizeResourceIdentity)
    );
    this.queueMatchedResourceUpdates(
      (subscribedUri) => normalizedTargets.has(normalizeResourceIdentity(subscribedUri)),
      reason
    );
  }

  /**
   * Notify subscribers for every resource beneath one or more URI prefixes.
   * Used for spreadsheet-scoped resources where many concrete URIs derive from the same root.
   */
  notifyResourceTreeUpdated(prefixes: string | readonly string[], reason?: string): void {
    const normalizedPrefixes = dedupeStrings(Array.isArray(prefixes) ? prefixes : [prefixes]).map(
      normalizeResourceIdentity
    );
    this.queueMatchedResourceUpdates((subscribedUri) => {
      const normalizedSubscribedUri = normalizeResourceIdentity(subscribedUri);
      return normalizedPrefixes.some((prefix) => normalizedSubscribedUri.startsWith(prefix));
    }, reason);
  }

  /**
   * Notify subscribers that spreadsheet-scoped resources changed.
   */
  notifySpreadsheetMutation(spreadsheetId: string, reason?: string): void {
    this.notifyResourceTreeUpdated(
      [`sheets:///${spreadsheetId}`, `debug://time-travel/${spreadsheetId}`],
      reason ?? `spreadsheet updated: ${spreadsheetId}`
    );
  }

  /**
   * Update known tool list and optionally send notifications/tools/list_changed when it changes.
   */
  syncToolList(
    toolNames: readonly string[],
    options?: { reason?: string; emitOnFirstSet?: boolean }
  ): void {
    const fingerprint = [...toolNames].sort().join('|');

    for (const [server, state] of this._servers.entries()) {
      const firstSet = state.toolListFingerprint === null;
      const changed = state.toolListFingerprint !== fingerprint;
      state.toolListFingerprint = fingerprint;

      if (!changed) {
        continue;
      }
      if (firstSet && !options?.emitOnFirstSet) {
        continue;
      }

      if (state.toolDebounceTimer) {
        clearTimeout(state.toolDebounceTimer);
      }

      state.toolDebounceTimer = setTimeout(() => {
        try {
          server.sendToolListChanged();
          if (options?.reason) {
            logger.debug('Tool list changed notification sent', { reason: options.reason });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('Failed to send tools/list_changed notification', { error: message });
        } finally {
          state.toolDebounceTimer = null;
        }
      }, this._debounceMs);
    }
  }

  /**
   * Notify when an analysis result is added
   */
  notifyAnalysisAdded(analysisId: string): void {
    this.notifyResourceUpdated(
      ['analyze://stats', 'analyze://results', `analyze://results/${analysisId}`],
      `analysis result added: ${analysisId}`
    );
    this.notifyResourceListChanged(`analysis result added: ${analysisId}`);
  }

  /**
   * Notify when cache is invalidated
   */
  notifyCacheInvalidated(spreadsheetId?: string): void {
    this.notifyResourceUpdated(
      ['cache://stats', 'cache://deduplication', 'metrics://cache'],
      'cache invalidated'
    );
    if (spreadsheetId) {
      this.notifySpreadsheetMutation(spreadsheetId, `cache invalidated for ${spreadsheetId}`);
    }
  }

  /**
   * Notify when transaction state changes
   */
  notifyTransactionStateChanged(
    transactionId: string,
    newState: string,
    spreadsheetId?: string
  ): void {
    this.notifyResourceUpdated('transaction://stats', `transaction ${transactionId} changed`);
    if (spreadsheetId && newState === 'committed') {
      this.notifySpreadsheetMutation(
        spreadsheetId,
        `transaction ${transactionId} changed to ${newState}`
      );
    }
  }

  /**
   * Notify when operation history is updated
   */
  notifyHistoryUpdated(operationCount: number, spreadsheetId?: string): void {
    this.notifyResourceUpdated(
      ['history://operations', 'history://stats', 'history://recent', 'history://failures'],
      `history updated (${operationCount} operations)`
    );
    if (spreadsheetId) {
      this.notifyResourceTreeUpdated(
        `debug://time-travel/${spreadsheetId}`,
        `history updated for ${spreadsheetId}`
      );
    }
  }

  /**
   * Check if the notification manager is initialized
   */
  isInitialized(): boolean {
    return this._servers.size > 0;
  }
}

// Singleton instance
export const resourceNotifications = new ResourceNotificationManager();

/**
 * Convenience function to set the server on the singleton
 */
export function initializeResourceNotifications(server: McpServer): void {
  resourceNotifications.setServer(server);
}

/**
 * Convenience function to remove the server from the singleton registry.
 */
export function teardownResourceNotifications(server: McpServer): void {
  resourceNotifications.unregisterServer(server);
}
