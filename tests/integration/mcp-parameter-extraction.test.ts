/**
 * MCP Parameter Extraction Integration Tests
 *
 * Tests the full MCP pipeline from JSON-RPC to handler invocation,
 * verifying that parameters are correctly extracted from the request wrapper.
 *
 * These tests catch regressions where parameter extraction breaks but unit tests still pass
 * (because unit tests bypass the MCP protocol layer).
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CLI_PATH = resolve(__dirname, '../../dist/cli.js');
const SERVER_TIMEOUT = 30000;
const HAS_BUILD = existsSync(CLI_PATH);

// These tests spawn a real STDIO server process and require a fresh build
// Skip unless TEST_INTEGRATION=true to avoid flaky timeouts
const describeStdio = HAS_BUILD && process.env['TEST_INTEGRATION'] ? describe : describe.skip;

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    structuredContent?: {
      response?: {
        success?: boolean;
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

describeStdio('MCP Parameter Extraction Integration', () => {
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
      timeoutMs = SERVER_TIMEOUT
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

    const cleanup = () => {
      childProcess.stdout?.off('data', onData);
      childProcess.off('error', onError);
    };

    return { request, cleanup };
  };

  it('should extract spreadsheetId from flat request wrapper (REG-003 fix)', async () => {
    child = spawn('node', [CLI_PATH]);
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

      // Test sheets_core.get with flat request.spreadsheetId
      const call = await rpc.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sheets_core',
          arguments: {
            request: {
              action: 'get',
              spreadsheetId: 'test-spreadsheet-id',
            },
          },
        },
      });

      // Should fail with auth error (proves parameter was extracted)
      // NOT "Missing required parameters: spreadsheetId"
      const errorCode = call.result?.structuredContent?.response?.error?.code;
      const errorMessage = call.result?.structuredContent?.response?.error?.message || '';

      expect(errorCode).not.toBe('VALIDATION_ERROR');
      expect(errorMessage).not.toContain('Missing required parameters');
      expect(errorMessage).not.toContain('spreadsheetId');
    } finally {
      rpc.cleanup();
      if (child && !child.killed) {
        child.kill();
      }
    }
  }, 45000);

  it('should extract sheetId=0 correctly (ISS-001 fix)', async () => {
    child = spawn('node', [CLI_PATH]);
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

      // Test with sheetId: 0 (falsy but valid)
      const call = await rpc.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sheets_core',
          arguments: {
            request: {
              action: 'get',
              spreadsheetId: 'test-spreadsheet-id',
              sheetId: 0,
            },
          },
        },
      });

      const errorMessage = call.result?.structuredContent?.response?.error?.message || '';

      // Should not reject sheetId=0 as invalid
      expect(errorMessage).not.toContain('sheetId');
      expect(errorMessage).not.toContain('Missing required parameters');
    } finally {
      rpc.cleanup();
      if (child && !child.killed) {
        child.kill();
      }
    }
  }, 45000);

  it('should not crash with "in operator" error on missing range (REG-001 fix)', async () => {
    child = spawn('node', [CLI_PATH]);
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

      // Test sheets_data.read with missing range parameter
      const call = await rpc.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sheets_data',
          arguments: {
            request: {
              action: 'read',
              spreadsheetId: 'test-id',
              // range intentionally missing
            },
          },
        },
      });

      const errorMessage = call.result?.structuredContent?.response?.error?.message || '';

      // Should fail gracefully, not crash with "Cannot use 'in' operator"
      expect(errorMessage).not.toContain("Cannot use 'in' operator");
      expect(errorMessage).not.toContain('in undefined');
    } finally {
      rpc.cleanup();
      if (child && !child.killed) {
        child.kill();
      }
    }
  }, 45000);

  it('should extract parameters for sheets_data.read (REG-001 fix)', async () => {
    child = spawn('node', [CLI_PATH]);
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

      // Test sheets_data.read with flat parameters
      const call = await rpc.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sheets_data',
          arguments: {
            request: {
              action: 'read',
              spreadsheetId: 'test-spreadsheet-id',
              range: { a1: 'Sheet1!A1:B2' },
            },
          },
        },
      });

      const errorCode = call.result?.structuredContent?.response?.error?.code;
      const errorMessage = call.result?.structuredContent?.response?.error?.message || '';

      // Should fail with auth error, NOT parameter validation error
      expect(errorCode).not.toBe('VALIDATION_ERROR');
      expect(errorMessage).not.toContain('Missing required parameters');
      expect(errorMessage).not.toContain('spreadsheetId');
    } finally {
      rpc.cleanup();
      if (child && !child.killed) {
        child.kill();
      }
    }
  }, 45000);

  it('should extract parameters for sheets_session.set_active (REG-005 fix)', async () => {
    child = spawn('node', [CLI_PATH]);
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

      // Test sheets_session.set_active with flat parameters
      const call = await rpc.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sheets_session',
          arguments: {
            request: {
              action: 'set_active',
              spreadsheetId: 'test-spreadsheet-id',
            },
          },
        },
      });

      const errorMessage = call.result?.structuredContent?.response?.error?.message || '';

      // Should not crash with "Cannot read properties of undefined (reading 'slice')"
      expect(errorMessage).not.toContain("Cannot read properties of undefined (reading 'slice')");
      expect(errorMessage).not.toContain('Missing required parameters');
    } finally {
      rpc.cleanup();
      if (child && !child.killed) {
        child.kill();
      }
    }
  }, 45000);
});
