import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { ServalSheetsServer, type ServalSheetsServerOptions } from '../../src/server.js';

export type McpTestHarness = {
  server: ServalSheetsServer;
  client: Client;
  close: () => Promise<void>;
};

export async function createServalSheetsTestHarness(
  options: {
    serverOptions?: ServalSheetsServerOptions;
    clientInfo?: { name: string; version: string };
    clientCapabilities?: ClientCapabilities;
  } = {}
): Promise<McpTestHarness> {
  const server = new ServalSheetsServer(options.serverOptions ?? {});
  await server.initialize();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.server.connect(serverTransport);

  const client = new Client(
    options.clientInfo ?? {
      name: 'servalsheets-test-client',
      version: '1.0.0',
    },
    {
      capabilities: options.clientCapabilities ?? {},
    }
  );
  await client.connect(clientTransport);

  const close = async (): Promise<void> => {
    await client.close();
    await server.server.close();
    await server.shutdown();
  };

  return { server, client, close };
}
