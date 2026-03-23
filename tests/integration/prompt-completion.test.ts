import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServalSheetsTestHarness,
  type McpTestHarness,
} from '../helpers/mcp-test-harness.js';

describe('prompt ref completion', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness({
      serverOptions: {
        name: 'servalsheets-prompt-completion-test',
        version: '1.0.0-test',
      },
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('completes spreadsheetId for ref/prompt arguments', async () => {
    const result = await harness.client.complete({
      ref: {
        type: 'ref/prompt',
        name: 'first_operation',
      },
      argument: {
        name: 'spreadsheetId',
        value: '1Bxi',
      },
    });

    expect(result.completion.values).toContain('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    expect(result.completion.hasMore).toBe(false);
  });
});
