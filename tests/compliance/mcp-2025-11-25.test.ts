/**
 * MCP Protocol 2025-11-25 Compliance Tests
 *
 * Verifies ServalSheets correctly implements the MCP protocol specification.
 * These tests work without live API credentials.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServalSheetsTestHarness, type McpTestHarness } from '../helpers/mcp-test-harness.js';
import { TOOL_COUNT, ACTION_COUNT } from '../../src/schemas/index.js';
import { MCP_PROTOCOL_VERSION, VERSION } from '../../src/version.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '../..');
const CLI_ENTRYPOINT = resolve(projectRoot, 'src/cli.ts');

describe('MCP Protocol 2025-11-25 Compliance', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createServalSheetsTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Protocol Version', () => {
    it('should use MCP protocol version 2025-11-25', () => {
      expect(MCP_PROTOCOL_VERSION).toBe('2025-11-25');
    });

    it('should have a valid server version', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('Tool Count Verification', () => {
    it('should have expected tool count defined', () => {
      expect(TOOL_COUNT).toBeGreaterThan(0);
      expect(TOOL_COUNT).toBeLessThanOrEqual(25); // Reasonable upper bound
    });

    it('should have expected action count defined', () => {
      expect(ACTION_COUNT).toBeGreaterThan(0);
      expect(ACTION_COUNT).toBeLessThanOrEqual(450); // Reasonable upper bound
    });
  });

  describe('Tool Call Response Format', () => {
    it('should return content array for display', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_auth',
        arguments: {
          request: { action: 'status' },
        },
      });

      // Content array for LLM display
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
    });

    // NOTE: structuredContent tests are in response-format-jsonrpc.test.ts
    // The SDK Client doesn't expose structuredContent, so we test at the JSON-RPC level
  });

  describe('Error Response Format', () => {
    it('should return error response for invalid operations', async () => {
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            action: 'get',
            spreadsheetId: 'invalid-spreadsheet-id-12345',
          },
        },
      });

      // Should have structuredContent with error
      if (result.structuredContent) {
        const structured = result.structuredContent as {
          response?: { success?: boolean; error?: { code?: string; message?: string } };
        };

        if (structured.response?.success === false) {
          expect(structured.response.error).toBeDefined();
          expect(structured.response.error?.code).toBeDefined();
          expect(structured.response.error?.message).toBeDefined();
        }
      }

      // Content should always be present
      expect(result.content).toBeDefined();
    });

    it('should handle validation errors gracefully', async () => {
      // Call with missing required fields
      const result = await harness.client.callTool({
        name: 'sheets_core',
        arguments: {
          request: {
            // Missing 'action' field
            spreadsheetId: 'test-id',
          },
        },
      });

      // Should return something (error or structured content)
      expect(result.content).toBeDefined();
    });
  });

  describe('Prompts Support', () => {
    it('should support prompts listing', async () => {
      const response = await harness.client.listPrompts();

      expect(response.prompts).toBeDefined();
      expect(Array.isArray(response.prompts)).toBe(true);
    });

    it('should have valid prompt definitions', async () => {
      const response = await harness.client.listPrompts();

      for (const prompt of response.prompts) {
        expect(prompt.name).toBeDefined();
        expect(typeof prompt.name).toBe('string');
      }
    });
  });

  describe('Resources Support', () => {
    it('should support resources listing', async () => {
      const response = await harness.client.listResources();

      expect(response.resources).toBeDefined();
      expect(Array.isArray(response.resources)).toBe(true);
    });
  });

  // ─── T6: Initialize cannot be cancelled (MCP §1.5) ─────────────────
  describe('Initialize protection (MCP §1.5)', () => {
    it('ignores cancellation notifications for in-flight initialize requests', { timeout: 60000 }, async () => {
      const child = spawn(process.execPath, ['--import', 'tsx', CLI_ENTRYPOINT, '--stdio'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MCP_TRANSPORT: 'stdio',
          SKIP_PREFLIGHT: 'true',
          ENABLE_PYTHON_COMPUTE: 'false',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderrBuffer = '';
      let lineBuffer = '';
      const pending = new Map<
        number,
        { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
      >();

      const onStdout = (chunk: Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          const json = JSON.parse(trimmed) as Record<string, unknown>;
          const id = json['id'];
          if (typeof id === 'number') {
            const pendingEntry = pending.get(id);
            if (pendingEntry) {
              pending.delete(id);
              pendingEntry.resolve(json);
            }
          }
        }
      };

      const onStderr = (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      };

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);

      const request = (
        payload: Record<string, unknown>,
        timeoutMs = 45000
      ): Promise<Record<string, unknown>> => {
        const id = payload['id'];
        if (typeof id !== 'number') {
          return Promise.reject(new Error('Request payload must include numeric id'));
        }

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Timed out waiting for response ${id}\n${stderrBuffer}`));
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

          child.stdin?.write(JSON.stringify(payload) + '\n');
        });
      };

      const notify = (payload: Record<string, unknown>) => {
        child.stdin?.write(JSON.stringify(payload) + '\n');
      };

      try {
        const initializePromise = request({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: 'cancel-test-client',
              version: '1.0.0',
            },
          },
        });
        notify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: {
            requestId: 1,
            reason: 'Client must not cancel initialize',
          },
        });
        const initializeResponse = await initializePromise;
        expect(initializeResponse['result']).toBeDefined();

        notify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        });
        const toolsResponse = await request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        });
        const result = toolsResponse['result'] as { tools?: unknown[] } | undefined;
        expect(Array.isArray(result?.tools)).toBe(true);
        expect(result?.tools?.length).toBeGreaterThan(0);
      } finally {
        child.stdout?.off('data', onStdout);
        child.stderr?.off('data', onStderr);
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      }
    });
  });

  // ─── T8: Task terminal state immutability (MCP §4) ─────────────────
  describe('Task terminal states (MCP §4)', () => {
    it('should not allow terminal task states to transition', async () => {
      // MCP spec §4: Terminal tasks (completed, failed, cancelled) MUST NOT transition
      const { InMemoryTaskStore } = await import('../../src/core/task-store.js');
      const store = new InMemoryTaskStore();

      // Create a task and move it to completed
      const task = await store.createTask({});
      await store.updateTaskStatus(task.taskId, 'completed');

      // Verify terminal state
      const completed = await store.getTask(task.taskId);
      expect(completed!.status).toBe('completed');

      // Attempting to transition from completed → working should be rejected or no-op
      try {
        await store.updateTaskStatus(task.taskId, 'working');
        const after = await store.getTask(task.taskId);
        expect(after!.status).toBe('completed');
      } catch {
        // Error thrown = terminal state enforcement works
        expect(true).toBe(true);
      }
    });
  });
});
