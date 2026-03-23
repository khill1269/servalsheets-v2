import { afterEach, describe, it, expect, vi } from 'vitest';
import { createTestHttpClient } from './mcp-client-simulator.js';

describe('MCP HTTP Client Simulator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures SSE notifications interleaved with the JSON-RPC response', async () => {
    const client = createTestHttpClient('http://example.com');

    const sseBody = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"tok-1","progress":25,"total":100}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/resources/updated","params":{"uri":"cache://stats"}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      '',
    ].join('\n');

    const response = await (
      client as unknown as {
        parseSseJsonRpc: (response: Response, id?: number) => Promise<unknown>;
      }
    ).parseSseJsonRpc(
      new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      7
    );

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: { ok: true },
    });

    expect(client.getNotifications()).toHaveLength(2);
    expect(client.getNotifications().map((notification) => notification.method)).toEqual([
      'notifications/progress',
      'notifications/resources/updated',
    ]);
  });

  it('waits for buffered and future notifications', async () => {
    const client = createTestHttpClient('http://example.com');
    const notification = {
      jsonrpc: '2.0' as const,
      method: 'notifications/resources/updated',
      params: { uri: 'cache://stats' },
    };

    (
      client as unknown as {
        handleIncomingNotification: (payload: typeof notification) => void;
      }
    ).handleIncomingNotification(notification);

    await expect(client.waitForNotification('notifications/resources/updated')).resolves.toMatchObject(
      notification
    );

    const futureWait = client.waitForNotification('notifications/progress', 200);
    setTimeout(() => {
      (
        client as unknown as {
          handleIncomingNotification: (payload: {
            jsonrpc: '2.0';
            method: 'notifications/progress';
            params: { progressToken: string; progress: number; total: number };
          }) => void;
        }
      ).handleIncomingNotification({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: 'tok-2', progress: 50, total: 100 },
      });
    }, 10);

    await expect(futureWait).resolves.toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 'tok-2', progress: 50, total: 100 },
    });
  });

  it('responds to server requests embedded in SSE before returning the final response', async () => {
    const client = createTestHttpClient('http://example.com');
    client.setRequestHandler('elicitation/create', () => ({
      action: 'accept',
      content: {
        approved: true,
        modifications: '',
        skipSnapshot: false,
      },
    }));

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          [
            'event: message',
            'data: {"jsonrpc":"2.0","id":41,"method":"elicitation/create","params":{"message":"Approve the plan","requestedSchema":{"type":"object","properties":{"approved":{"type":"boolean"}}}}}',
            '',
            'event: message',
            'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream',
              'mcp-session-id': 'session-1',
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'session-1',
          },
        })
      );

    const response = await (
      client as unknown as {
        sendRequest: (request: Record<string, unknown>) => Promise<unknown>;
      }
    ).sendRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'sheets_confirm',
        arguments: {
          request: {
            action: 'request',
          },
        },
      },
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: { ok: true },
    });
    expect(client.getRequests()).toEqual([
      expect.objectContaining({
        jsonrpc: '2.0',
        id: 41,
        method: 'elicitation/create',
      }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'http://example.com/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
          'Mcp-Session-Id': 'session-1',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 41,
          result: {
            action: 'accept',
            content: {
              approved: true,
              modifications: '',
              skipSnapshot: false,
            },
          },
        }),
      })
    );
  });
});
