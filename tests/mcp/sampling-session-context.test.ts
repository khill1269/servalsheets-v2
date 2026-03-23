/**
 * Tests for session context enrichment in sampling calls (Task A4)
 *
 * Verifies that analyzeData() prepends session context (active spreadsheet,
 * recent operations) to the user prompt when a SessionContextManager is provided.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env module before imports
vi.mock('../../src/config/env.js', () => ({
  getEnv: () => ({
    SAMPLING_TIMEOUT_MS: 30000,
    SAMPLING_CONSENT_CACHE_TTL_MS: 0,
  }),
}));

// Mock request-context
vi.mock('../../src/utils/request-context.js', () => ({
  getRequestContext: () => null,
  createRequestAbortError: (reason: unknown, msg: string) => new Error(msg),
  sendProgress: vi.fn(),
}));

// Mock sampling-context-cache
vi.mock('../../src/services/sampling-context-cache.js', () => ({
  getSpreadsheetContext: vi.fn().mockResolvedValue(null),
  formatContextForPrompt: vi.fn().mockReturnValue(''),
}));

// Mock context-compressor
vi.mock('../../src/services/context-compressor.js', () => ({
  compressContext: vi.fn(),
  formatCompressedContext: vi.fn().mockReturnValue(''),
}));

import { analyzeData } from '../../src/mcp/sampling.js';
import type { SamplingServer } from '../../src/mcp/sampling.js';

function makeMockServer(capturedMessages: unknown[][]): SamplingServer {
  return {
    getClientCapabilities: () => ({
      sampling: {},
    }),
    createMessage: vi.fn().mockImplementation((params: { messages: unknown[] }) => {
      capturedMessages.push(params.messages);
      return Promise.resolve({
        role: 'assistant',
        content: { type: 'text', text: 'analysis result' },
        model: 'claude-3-5-haiku-latest',
        stopReason: 'end_turn',
      });
    }),
  };
}

interface MockSessionContext {
  getSummary: () => {
    activeSpreadsheet?: { title: string; sheetNames: string[] };
    recentOperations?: Array<{ tool?: string; action?: string; range?: string }>;
  };
}

describe('analyzeData() — session context enrichment', () => {
  let capturedMessages: unknown[][];
  let server: SamplingServer;

  beforeEach(() => {
    capturedMessages = [];
    server = makeMockServer(capturedMessages);
  });

  it('prompt is unchanged when no session context provided', async () => {
    await analyzeData(
      server,
      { data: [['A', 'B'], [1, 2]], question: 'What is the sum?' },
      {}
    );

    const messages = capturedMessages[0] as Array<{ content: { text: string } }>;
    expect(messages[0].content.text).not.toContain('Active spreadsheet:');
    expect(messages[0].content.text).not.toContain('Recent operations');
  });

  it('includes active spreadsheet in prompt when sessionContext has one', async () => {
    const sessionContext: MockSessionContext = {
      getSummary: () => ({
        activeSpreadsheet: {
          title: 'Q1 Sales Report',
          sheetNames: ['Sheet1', 'Revenue', 'Costs'],
        },
        recentOperations: [],
      }),
    };

    await analyzeData(
      server,
      { data: [['Product', 'Sales'], ['A', 100]], question: 'Best product?' },
      { sessionContext: sessionContext as unknown as import('../../src/services/session-context.js').SessionContextManager }
    );

    const messages = capturedMessages[0] as Array<{ content: { text: string } }>;
    const promptText = messages[0].content.text;
    expect(promptText).toContain('Q1 Sales Report');
    expect(promptText).toContain('Sheet1');
    expect(promptText).toContain('Revenue');
  });

  it('includes recent operations in prompt when present', async () => {
    const sessionContext: MockSessionContext = {
      getSummary: () => ({
        recentOperations: [
          { tool: 'sheets_data', action: 'read', range: 'Sheet1!A1:B10' },
          { tool: 'sheets_format', action: 'set_format', range: 'Sheet1!A1:A1' },
        ],
      }),
    };

    await analyzeData(
      server,
      { data: [['X'], [1]], question: 'Analyze this.' },
      { sessionContext: sessionContext as unknown as import('../../src/services/session-context.js').SessionContextManager }
    );

    const messages = capturedMessages[0] as Array<{ content: { text: string } }>;
    const promptText = messages[0].content.text;
    expect(promptText).toContain('sheets_data');
    expect(promptText).toContain('sheets_format');
    expect(promptText).toContain('Sheet1!A1:B10');
  });

  it('prompt unchanged when sessionContext.getSummary returns empty context', async () => {
    const sessionContext: MockSessionContext = {
      getSummary: () => ({
        activeSpreadsheet: undefined,
        recentOperations: [],
      }),
    };

    await analyzeData(
      server,
      { data: [['X'], [1]], question: 'Analyze.' },
      { sessionContext: sessionContext as unknown as import('../../src/services/session-context.js').SessionContextManager }
    );

    const messages = capturedMessages[0] as Array<{ content: { text: string } }>;
    const promptText = messages[0].content.text;
    expect(promptText).not.toContain('Active spreadsheet:');
    expect(promptText).not.toContain('Recent operations');
  });

  it('shows only last 5 recent operations', async () => {
    const sessionContext: MockSessionContext = {
      getSummary: () => ({
        recentOperations: [
          { tool: 'sheets_data', action: 'read', range: 'A1' },
          { tool: 'sheets_data', action: 'read', range: 'B1' },
          { tool: 'sheets_data', action: 'read', range: 'C1' },
          { tool: 'sheets_data', action: 'read', range: 'D1' },
          { tool: 'sheets_data', action: 'read', range: 'E1' },
          { tool: 'sheets_format', action: 'set_format', range: 'F1' },
          { tool: 'sheets_format', action: 'set_format', range: 'G1' },
        ],
      }),
    };

    await analyzeData(
      server,
      { data: [['X'], [1]], question: 'Analyze.' },
      { sessionContext: sessionContext as unknown as import('../../src/services/session-context.js').SessionContextManager }
    );

    const messages = capturedMessages[0] as Array<{ content: { text: string } }>;
    const promptText = messages[0].content.text;
    // Last 5: C1, D1, E1, F1, G1 — first two (A1, B1) should not appear
    expect(promptText).toContain('G1');
    expect(promptText).toContain('F1');
    // A1 and B1 were beyond the 5-operation window
    expect(promptText).not.toContain('- sheets_data.read on A1\n');
  });
});
