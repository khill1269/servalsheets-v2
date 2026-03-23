import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServalSheetsTestHarness, type McpTestHarness } from '../helpers/mcp-test-harness.js';

function parseResponse(result: { content: unknown; structuredContent?: unknown }): Record<string, unknown> {
  if (
    result.structuredContent &&
    typeof result.structuredContent === 'object' &&
    !Array.isArray(result.structuredContent)
  ) {
    return result.structuredContent as Record<string, unknown>;
  }

  const content = result.content as Array<{ type: string; text?: string }>;
  const textBlock = content.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Missing text content block');
  }
  return JSON.parse(textBlock.text) as Record<string, unknown>;
}

/**
 * Asserts that a tool call routed to the correct action.
 * Passes if:
 *   - response.action === expectedAction (success path), OR
 *   - response.success === false AND the error is NOT an "Unknown action" routing error
 *     (meaning the action was dispatched correctly but failed at the API/auth level)
 */
function assertRoutedCorrectly(
  response: Record<string, unknown>,
  expectedAction: string
): void {
  if (response.action === expectedAction) {
    return; // success path — action dispatched and returned correctly
  }
  // Failure path — check it's not a routing error
  if (response.success === false) {
    const error = response.error as Record<string, unknown> | undefined;
    const errorMessage = String(error?.message ?? '');
    const isRoutingError =
      errorMessage.toLowerCase().includes('unknown action') ||
      errorMessage.toLowerCase().includes('invalid action');
    expect(isRoutingError, `Expected routing to '${expectedAction}' but got routing error: ${errorMessage}`).toBe(false);
    return; // API/auth failure, routing was correct
  }
  // success:true but wrong action field
  expect(response.action).toBe(expectedAction);
}

describe('MCP Evaluation Suite', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Action Routing Accuracy', () => {
    it('Test 1: read range — NOT find_replace', async () => {
      // NOT sheets_data.find_replace — read targets known cells
      const result = await harness.client.callTool({
        name: 'sheets_data',
        arguments: {
          request: {
            action: 'read',
            spreadsheetId: 'test-sheet-1',
            range: 'Sheet1!A1:B10',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'read');
    });

    it('Test 2: import CSV — import_csv parses headers + types automatically', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_composite',
        arguments: {
          request: {
            action: 'import_csv',
            spreadsheetId: 'test-sheet-1',
            csvData: 'name,age\nAlice,30\nBob,25',
            mode: 'new_sheet',
            newSheetName: 'Imported',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'import_csv');
    });

    it('Test 3: add tab — add_sheet not create (create makes a NEW spreadsheet)', async () => {
      // core.create creates a NEW spreadsheet; add_sheet adds a tab to existing
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'add_sheet',
            spreadsheetId: 'test-sheet-1',
            title: 'Sales',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'add_sheet');
    });

    it('Test 4: insert rows — dimensions.insert not data.write', async () => {
      // dimensions.insert shifts existing rows; data.write overwrites cells
      const result = await harness.client.callTool({
        name: 'sheets_dimensions',
        arguments: {
          request: {
            action: 'insert',
            spreadsheetId: 'test-sheet-1',
            sheetId: 0,
            dimension: 'ROWS',
            startIndex: 4,
            count: 3,
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'insert');
    });

    it('Test 5: bold header row — batch_format is canonical for formatting', async () => {
      // batch_format is the canonical path for formatting
      const result = await harness.client.callTool({
        name: 'sheets_format',
        arguments: {
          request: {
            action: 'batch_format',
            spreadsheetId: 'test-sheet-1',
            operations: [
              {
                type: 'text_format',
                range: 'Sheet1!1:1',
                textFormat: { bold: true },
              },
            ],
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'batch_format');
    });

    it('Test 6: share as editor — role is writer not editor (Google Drive API terminology)', async () => {
      // Google Drive API uses 'writer' for editor-level access
      const result = await harness.client.callTool({
        name: 'sheets_collaborate',
        arguments: {
          request: {
            action: 'share_add',
            spreadsheetId: 'test-sheet-1',
            type: 'user',
            emailAddress: 'alice@example.com',
            role: 'writer',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      // May fail with PERMISSION_DENIED/auth error in test env — routing must be correct
      assertRoutedCorrectly(response, 'share_add');
    });

    it('Test 7: undo — history.undo not history.revert_to', async () => {
      // history.undo reverses last tracked op; revert_to restores a specific revision
      const result = await harness.client.callTool({
        name: 'sheets_history',
        arguments: {
          request: {
            action: 'undo',
            spreadsheetId: 'test-sheet-1',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'undo');
    });

    it('Test 8: cell dependents — dependencies.get_dependents traces recalculation targets', async () => {
      // get_dependents traces what cells would recalculate if B2 changes
      const result = await harness.client.callTool({
        name: 'sheets_dependencies',
        arguments: {
          request: {
            action: 'get_dependents',
            spreadsheetId: 'test-sheet-1',
            cell: 'Sheet1!B2',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'get_dependents');
    });

    it('Test 9: what-if scenario — dependencies.model_scenario traces formula cascade', async () => {
      // model_scenario traces formula cascade for hypothetical input changes
      const result = await harness.client.callTool({
        name: 'sheets_dependencies',
        arguments: {
          request: {
            action: 'model_scenario',
            spreadsheetId: 'test-sheet-1',
            changes: [{ cell: 'Sheet1!B2', newValue: 80000 }],
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'model_scenario');
    });

    it('Test 10: generate spreadsheet — composite.generate_sheet uses AI to build from description', async () => {
      // generate_sheet uses AI to build structured spreadsheet from description
      const result = await harness.client.callTool({
        name: 'sheets_composite',
        arguments: {
          request: {
            action: 'generate_sheet',
            spreadsheetId: 'test-sheet-1',
            description: 'Q1 budget tracker with monthly columns',
          },
        },
      });
      const payload = parseResponse(result);
      const response = payload.response as Record<string, unknown>;
      assertRoutedCorrectly(response, 'generate_sheet');
    });
  });

  it('evaluates session context lifecycle workflow', async () => {
    await harness.client.callTool({
      name: 'sheets_session',
      arguments: {
        request: {
          action: 'set_active',
          spreadsheetId: 'eval-sheet-123',
          title: 'Evaluation Sheet',
          sheetNames: ['Sheet1'],
        },
      },
    });

    const active = await harness.client.callTool({
      name: 'sheets_session',
      arguments: {
        request: {
          action: 'get_active',
        },
      },
    });
    const activePayload = parseResponse(active);
    const activeResponse = activePayload.response as Record<string, unknown>;
    expect(activeResponse.success).toBe(true);

    const context = await harness.client.callTool({
      name: 'sheets_session',
      arguments: {
        request: {
          action: 'get_context',
        },
      },
    });
    const contextPayload = parseResponse(context);
    const contextResponse = contextPayload.response as Record<string, unknown>;
    expect(contextResponse.success).toBe(true);

    const authStatus = await harness.client.callTool({
      name: 'sheets_auth',
      arguments: {
        request: {
          action: 'status',
        },
      },
    });
    const authPayload = parseResponse(authStatus);
    expect((authPayload.response as Record<string, unknown>).success).toBe(true);

    const historyList = await harness.client.callTool({
      name: 'sheets_history',
      arguments: {
        request: {
          action: 'list',
          count: 5,
        },
      },
    });
    const historyListPayload = parseResponse(historyList);
    expect((historyListPayload.response as Record<string, unknown>).success).toBe(true);
  });
});
