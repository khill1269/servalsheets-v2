import { afterAll, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerServalSheetsPrompts } from '../../src/mcp/registration/index.js';

function getPrivateField<T>(obj: unknown, key: string): T | undefined {
  return (obj as Record<string, unknown>)[key] as T | undefined;
}

describe('prompt argument compatibility', () => {
  const server = new McpServer({
    name: 'servalsheets-prompt-compat-test',
    version: '1.0.0',
  });

  registerServalSheetsPrompts(server);

  afterAll(async () => {
    await server.close();
  });

  it('setup_collaboration accepts comma-separated collaborators from prompt arguments', async () => {
    const prompts = getPrivateField<Record<string, { callback: (args: Record<string, unknown>) => Promise<unknown> }>>(
      server as unknown,
      '_registeredPrompts'
    );
    const setupCollaboration = prompts?.['setup_collaboration'];

    expect(setupCollaboration).toBeDefined();

    const result = (await setupCollaboration!.callback({
      spreadsheetId: 'spreadsheet-123',
      collaborators: 'alice@example.com, bob@example.com',
      role: 'writer',
    })) as { messages: Array<{ content: { type: string; text: string } }> };

    expect(result.messages[0]?.content.type).toBe('text');
    expect(result.messages[0]?.content.text).toContain('Adding 2 collaborator(s)');
    expect(result.messages[0]?.content.text).toContain('alice@example.com');
    expect(result.messages[0]?.content.text).toContain('bob@example.com');
  });
});
