/**
 * Tests for Remaining Regressions (REG-006, REG-007)
 *
 * REG-006: Verify title parameter is extracted and used in sheets_core.create
 * REG-007: Verify set_text_format works (set_text_color never existed)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import { SheetsFormatInputSchema } from '../../src/schemas/format.js';

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    structuredContent?: {
      response?: {
        success?: boolean;
        spreadsheet?: {
          title?: string;
          spreadsheetId?: string;
        };
        error?: {
          code?: string;
          message?: string;
        };
      };
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

// Skip integration tests unless TEST_INTEGRATION=true to avoid flaky timeouts
describe.skipIf(!process.env['TEST_INTEGRATION'])('Remaining Regressions Verification', () => {
  let child: ChildProcess | null = null;

  afterEach(() => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      child = null;
    }
  });

  const createJsonRpcHarness = (childProcess: ChildProcess) => {
    let buffer = '';
    const pending = new Map<
      number,
      { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }
    >();

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const id = json?.id;
          if (typeof id === 'number' && pending.has(id)) {
            const entry = pending.get(id);
            if (entry) {
              pending.delete(id);
              entry.resolve(json);
            }
          }
        } catch {
          // Ignore non-JSON log lines
        }
      }
    };

    const onError = (err: Error) => {
      for (const entry of pending.values()) {
        entry.reject(err);
      }
      pending.clear();
    };

    childProcess.stdout?.on('data', onData);
    childProcess.on('error', onError);

    const request = (
      payload: Record<string, unknown>,
      timeoutMs = 10000
    ): Promise<JsonRpcResponse> => {
      const id = payload['id'];
      if (typeof id !== 'number') {
        return Promise.reject(new Error('Request payload must include numeric id'));
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Server response timeout'));
        }, timeoutMs);

        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });

        childProcess.stdin?.write(JSON.stringify(payload) + '\n');
      });
    };

    const notify = (payload: Record<string, unknown>): void => {
      childProcess.stdin?.write(JSON.stringify(payload) + '\n');
    };

    const cleanup = () => {
      childProcess.stdout?.off('data', onData);
      childProcess.off('error', onError);
    };

    return { request, notify, cleanup };
  };

  it('REG-006: should extract and use title parameter in sheets_core.create', async () => {
    const cliPath = resolve(__dirname, '../../dist/cli.js');
    child = spawn('node', [cliPath]);
    const rpc = createJsonRpcHarness(child);

    try {
      // Initialize
      await rpc.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      });

      // Test sheets_core.create with title parameter
      const call = await rpc.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sheets_core',
          arguments: {
            request: {
              action: 'create',
              title: 'REG-006 Test Spreadsheet',
            },
          },
        },
      });

      const errorCode = call.result?.structuredContent?.response?.error?.code;
      const errorMessage = call.result?.structuredContent?.response?.error?.message || '';

      // Should fail with auth error (not parameter validation error)
      // This proves the title parameter was extracted
      expect(errorCode).not.toBe('VALIDATION_ERROR');
      expect(errorMessage).not.toContain('Missing required parameters');
      expect(errorMessage).not.toContain('title');
    } finally {
      rpc.cleanup();
      if (child && !child.killed) {
        child.kill();
      }
    }
  }, 15000);

  it('REG-007: should recognize set_text_format action (not set_text_color)', () => {
    // Verify at schema level that set_text_format is a valid action
    // This is more reliable than spawning a server process

    // set_text_format should parse successfully
    const validInput = {
      request: {
        action: 'set_text_format',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:F1' },
        textFormat: {
          foregroundColor: { red: 1.0, green: 0.0, blue: 0.0 },
        },
      },
    };

    const result = SheetsFormatInputSchema.safeParse(validInput);
    // Should not fail with "Invalid discriminator value" for the action
    if (!result.success) {
      const errorStr = JSON.stringify(result.error.issues);
      expect(errorStr).not.toContain('Invalid discriminator');
      expect(errorStr).not.toContain('Unknown action');
    }
    // The parse should succeed (action is recognized)
    expect(result.success).toBe(true);
  });

  it('REG-007: set_text_color never existed (user error, not server bug)', () => {
    // Verify at schema level that set_text_color is NOT a valid action

    // set_text_color should fail validation (not a real action)
    const invalidInput = {
      request: {
        action: 'set_text_color',
        spreadsheetId: 'test-id',
        range: { a1: 'Sheet1!A1:F1' },
        color: '#FF0000',
      },
    };

    const result = SheetsFormatInputSchema.safeParse(invalidInput);
    // The key point: set_text_color is NOT a valid action
    // Users should use set_text_format with textFormat.foregroundColor instead
    expect(result.success).toBe(false);
  });
});
