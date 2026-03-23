/**
 * HTTP server stop cleanup regression tests.
 *
 * Verifies stop() disposes session resources and session-scoped context.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHttpServer } from '../../src/http-server.js';
import { getOrCreateSessionContext } from '../../src/services/session-context.js';

describe('HTTP Server Stop Cleanup', () => {
  it('should dispose active sessions and remove session context on stop()', async () => {
    const server = createHttpServer({
      host: '127.0.0.1',
      port: 0,
    });

    const sessions = server.sessions as Map<
      string,
      {
        transport: { close?: () => void };
        taskStore: { dispose: () => void };
        eventStore?: { clear: () => void };
        securityContext: unknown;
        lastActivity: number;
      }
    >;

    const sessionId = 'stop-cleanup-test-session';
    const initialContext = getOrCreateSessionContext(sessionId);
    const closeSpy = vi.fn();
    const disposeSpy = vi.fn();
    const clearSpy = vi.fn();

    sessions.set(sessionId, {
      transport: { close: closeSpy },
      taskStore: { dispose: disposeSpy },
      eventStore: { clear: clearSpy },
      securityContext: { userId: 'test-user' },
      lastActivity: Date.now(),
    });

    await server.stop?.();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(0);

    const recreatedContext = getOrCreateSessionContext(sessionId);
    expect(recreatedContext).not.toBe(initialContext);
  });
});
