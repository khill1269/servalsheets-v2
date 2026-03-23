import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_COUNT, ACTION_COUNT } from '../../src/schemas/action-counts.js';
import {
  createServalSheetsTestHarness,
  type McpTestHarness,
} from '../helpers/mcp-test-harness.js';

describe('MCP audit docs', () => {
  let harness: McpTestHarness;
  let runtimeSnapshot: {
    tools: number;
    prompts: number;
    resources: number;
  };

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        name: 'servalsheets-audit-docs-test',
        version: '1.0.0-test',
      },
    });

    const tools = await harness.client.listTools();
    const prompts = await harness.client.listPrompts();
    const resources = await harness.client.listResources();

    runtimeSnapshot = {
      tools: tools.tools.length,
      prompts: prompts.prompts.length,
      resources: resources.resources.length,
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  it('source manifest lists the pinned MCP source set and runtime snapshot', () => {
    const manifest = readFileSync('docs/review/MCP_PROTOCOL_SOURCE_MANIFEST.md', 'utf-8');

    expect(manifest).toContain('March 15, 2026');
    expect(manifest).toContain('2025-11-25');
    expect(manifest).toContain('2025-06-18');
    expect(manifest).toContain(`${TOOL_COUNT} tools`);
    expect(manifest).toContain(`${ACTION_COUNT} actions`);
    expect(manifest).toContain(`${runtimeSnapshot.prompts} prompts`);
    expect(manifest).toContain(`${runtimeSnapshot.resources} resources`);
    expect(manifest).toContain('https://modelcontextprotocol.io/specification/2025-11-25/architecture');
    expect(manifest).toContain('https://modelcontextprotocol.io/specification/2025-11-25/server/tools');
    expect(manifest).toContain(
      'https://modelcontextprotocol.io/specification/2025-11-25/server/resources'
    );
    expect(manifest).toContain(
      'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion'
    );
  });

  it('coordinator audit and checklist both reflect the verified runtime snapshot', () => {
    const coordinator = readFileSync('docs/review/MCP_PROTOCOL_COORDINATOR_AUDIT.md', 'utf-8');
    const checklist = readFileSync('docs/compliance/MCP_2025-11-25_COMPLIANCE_CHECKLIST.md', 'utf-8');

    const snapshotText = `${TOOL_COUNT} tools, ${ACTION_COUNT} actions, ${runtimeSnapshot.prompts} prompts, ${runtimeSnapshot.resources} resources`;

    expect(coordinator).toContain(snapshotText);
    expect(checklist).toContain(snapshotText);
    expect(coordinator).toContain('2025-06-18');
    expect(checklist).toContain('2025-06-18');
    expect(coordinator).toContain('resources/subscribe');
    expect(checklist).toContain('resources/subscribe');
  });
});
