/**
 * ServalSheets - Confirm Handler Tests
 *
 * Tests for MCP Elicitation-based confirmation operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmHandler } from '../../src/handlers/confirm.js';
import { SheetsConfirmOutputSchema } from '../../src/schemas/confirm.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { resetConfirmationService } from '../../src/services/confirm-service.js';
import { getCapabilityCacheService } from '../../src/services/capability-cache.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// Mock MCP Server with elicitation capability
const createMockServer = () => ({
  elicitInput: vi.fn(),
  getClientCapabilities: vi.fn(),
});

// Mock handler context
const createMockContext = (overrides?: Partial<HandlerContext>): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: {} as any,
  server: createMockServer() as any,
  requestId: 'test-session-123',
  ...overrides,
});

describe('ConfirmHandler', () => {
  let mockContext: HandlerContext;
  let handler: ConfirmHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetConfirmationService();
    // Clear capability cache before each test
    await getCapabilityCacheService().clearAll();
    mockContext = createMockContext();
    handler = new ConfirmHandler({ context: mockContext });
  });

  afterEach(async () => {
    resetConfirmationService();
    // Clear capability cache after each test
    await getCapabilityCacheService().clearAll();
  });

  describe('request action - successful confirmation', () => {
    it('should successfully request user confirmation for a plan', async () => {
      // Mock client capabilities to support elicitation
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      // Mock user approving the plan
      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'accept',
        content: {
          approved: true,
          modifications: '',
          skipSnapshot: false,
        },
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Update Sales Data',
          description: 'Update Q4 sales figures in the report',
          steps: [
            {
              stepNumber: 1,
              description: 'Read current sales data',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
              estimatedApiCalls: 1,
              isDestructive: false,
              canUndo: true,
            },
            {
              stepNumber: 2,
              description: 'Update sales totals',
              tool: 'sheets_data',
              action: 'update_values',
              risk: 'medium',
              estimatedApiCalls: 1,
              isDestructive: true,
              canUndo: false,
            },
          ],
          willCreateSnapshot: true,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('request');
        expect(result.response.planId).toBeDefined();
        expect(result.response.confirmation).toMatchObject({
          approved: true,
          action: 'accept',
        });
        expect(result.response.message).toContain('approved');
      }

      expect(mockContext.server!.elicitInput).toHaveBeenCalledWith({
        mode: 'form',
        message: expect.stringContaining('Update Sales Data'),
        requestedSchema: expect.objectContaining({
          type: 'object',
          properties: expect.any(Object),
        }),
      });

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle user modifications to the plan', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'accept',
        content: {
          approved: true,
          modifications: 'Please also backup Sheet2 before changes',
          skipSnapshot: false,
        },
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Bulk Data Import',
          description: 'Import new customer records',
          steps: [
            {
              stepNumber: 1,
              description: 'Clear existing data',
              tool: 'sheets_data',
              action: 'clear_values',
              risk: 'high',
              estimatedApiCalls: 1,
              isDestructive: true,
              canUndo: false,
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.confirmation?.approved).toBe(true);
        expect(result.response.confirmation?.modifications).toBe(
          'Please also backup Sheet2 before changes'
        );
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle complex multi-step plan with critical risk', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'accept',
        content: { approved: true },
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Database Restructure',
          description: 'Reorganize all sheets and merge data',
          steps: [
            {
              stepNumber: 1,
              description: 'Delete old sheets',
              tool: 'sheets_core',
              action: 'delete_sheet',
              risk: 'critical',
              estimatedApiCalls: 5,
              isDestructive: true,
              canUndo: false,
            },
            {
              stepNumber: 2,
              description: 'Create new structure',
              tool: 'sheets_core',
              action: 'add_sheet',
              risk: 'low',
              estimatedApiCalls: 3,
              isDestructive: false,
              canUndo: true,
            },
            {
              stepNumber: 3,
              description: 'Migrate data',
              tool: 'sheets_data',
              action: 'batch_write',
              risk: 'high',
              estimatedApiCalls: 10,
              isDestructive: true,
              canUndo: false,
            },
          ],
          willCreateSnapshot: true,
          additionalWarnings: ['This operation will take several minutes'],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.confirmation?.approved).toBe(true);
      }

      // Verify elicitation was called with proper risk indicators
      const call = vi.mocked(mockContext.server!.elicitInput).mock.calls[0][0];
      expect(call.message).toContain('Database Restructure');
      expect(call.message).toContain('CRITICAL'); // Risk level shown in uppercase
    });
  });

  describe('request action - declined/cancelled', () => {
    it('should handle user declining the plan', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'decline',
        content: { approved: false },
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Delete All Data',
          description: 'Remove all customer records',
          steps: [
            {
              stepNumber: 1,
              description: 'Clear all sheets',
              tool: 'sheets_data',
              action: 'clear_values',
              risk: 'critical',
              estimatedApiCalls: 5,
              isDestructive: true,
              canUndo: false,
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.confirmation?.approved).toBe(false);
        expect(result.response.confirmation?.action).toBe('decline');
        expect(result.response.message).toContain('declined');
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should isolate elicitation capability cache by live request context when handler requestId is unset', async () => {
      const sharedContext = createMockContext({ requestId: undefined });
      const sharedHandler = new ConfirmHandler({ context: sharedContext });

      vi.mocked(sharedContext.server!.getClientCapabilities).mockReturnValueOnce({} as any);

      const firstResult = await runWithRequestContext(
        createRequestContext({ requestId: 'req-no-elicitation' }),
        () =>
          sharedHandler.handle({
            action: 'request',
            plan: {
              title: 'First Plan',
              description: 'Should fail due to missing elicitation',
              steps: [],
            },
          })
      );

      expect(firstResult.response.success).toBe(false);
      if (!firstResult.response.success) {
        expect(firstResult.response.error.code).toBe('ELICITATION_UNAVAILABLE');
      }

      vi.mocked(sharedContext.server!.getClientCapabilities).mockReturnValueOnce({
        elicitation: true,
      } as any);
      vi.mocked(sharedContext.server!.elicitInput).mockResolvedValueOnce({
        action: 'accept',
        content: {
          approved: true,
        },
      } as any);

      const secondResult = await runWithRequestContext(
        createRequestContext({ requestId: 'req-with-elicitation' }),
        () =>
          sharedHandler.handle({
            action: 'request',
            plan: {
              title: 'Second Plan',
              description: 'Should succeed with distinct capability cache key',
              steps: [],
            },
          })
      );

      expect(secondResult.response.success).toBe(true);
      expect(sharedContext.server!.getClientCapabilities).toHaveBeenCalledTimes(2);
    });

    it('should handle user cancelling the plan', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'cancel',
        content: {},
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Risky Operation',
          description: 'This might cause issues',
          steps: [
            {
              stepNumber: 1,
              description: 'Risky step',
              tool: 'sheets_data',
              action: 'update_values',
              risk: 'high',
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.confirmation?.approved).toBe(false);
        expect(result.response.confirmation?.action).toBe('cancel');
        expect(result.response.message).toContain('cancelled');
      }
    });

    it('should handle user unchecking approved checkbox', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      // User accepts but unchecks the approved box
      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'accept',
        content: { approved: false },
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Test Plan',
          description: 'Test operation',
          steps: [
            {
              stepNumber: 1,
              description: 'Test step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        // Should treat as cancel since approved is false
        expect(result.response.confirmation?.approved).toBe(false);
      }
    });
  });

  describe('request action - error cases', () => {
    it('should error when server is not available', async () => {
      const contextWithoutServer = createMockContext({ server: undefined });
      const handlerWithoutServer = new ConfirmHandler({ context: contextWithoutServer });

      const result = await handlerWithoutServer.handle({
        action: 'request',
        plan: {
          title: 'Test Plan',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Test step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('ELICITATION_UNAVAILABLE');
        expect(result.response.error.message).toContain('Server instance not available');
        expect(result.response.error.fixableVia).toEqual({
          tool: 'sheets_confirm',
          action: 'wizard_start',
          params: {
            title: 'Confirm operation',
          },
        });
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should error when client does not support elicitation', async () => {
      // Mock client without elicitation support
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: false,
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Test Plan',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Test step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('ELICITATION_UNAVAILABLE');
        expect(result.response.error.message).toContain('MCP Elicitation not available');
        expect(result.response.error.retryable).toBe(false);
        expect(result.response.error.fixableVia).toEqual({
          tool: 'sheets_confirm',
          action: 'wizard_start',
          params: {
            title: 'Confirm operation',
          },
        });
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle elicitation errors gracefully', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      vi.mocked(mockContext.server!.elicitInput).mockRejectedValue(
        new Error('Elicitation timeout')
      );

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Test Plan',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Test step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('Elicitation timeout');
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle capability check failure', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Test Plan',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Test step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('get_stats action', () => {
    it('should return initial stats with no confirmations', async () => {
      const result = await handler.handle({
        action: 'get_stats',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('get_stats');
        expect(result.response.stats).toMatchObject({
          totalConfirmations: 0,
          approved: 0,
          declined: 0,
          cancelled: 0,
          approvalRate: 0,
          avgResponseTime: 0,
        });
        expect(result.response.message).toContain('0 confirmations');
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return stats after confirmations', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      // First confirmation - approved
      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'accept',
        content: { approved: true },
      } as any);

      await handler.handle({
        action: 'request',
        plan: {
          title: 'Plan 1',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Step 1',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      // Second confirmation - declined
      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'decline',
        content: {},
      } as any);

      await handler.handle({
        action: 'request',
        plan: {
          title: 'Plan 2',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Step 1',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      // Get stats
      const result = await handler.handle({
        action: 'get_stats',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.stats).toMatchObject({
          totalConfirmations: 2,
          approved: 1,
          declined: 1,
          cancelled: 0,
          approvalRate: 50,
        });
        // avgResponseTime might be 0 in fast tests, so just check it exists
        expect(result.response.stats!.avgResponseTime).toBeGreaterThanOrEqual(0);
        expect(result.response.message).toContain('2 confirmations');
        expect(result.response.message).toContain('50.0% approval rate');
      }

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should calculate approval rate correctly', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      // 3 approved, 1 declined, 1 cancelled = 60% approval rate
      for (let i = 0; i < 3; i++) {
        vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
          action: 'accept',
          content: { approved: true },
        } as any);

        await handler.handle({
          action: 'request',
          plan: {
            title: `Plan ${i}`,
            description: 'Test',
            steps: [
              {
                stepNumber: 1,
                description: 'Step',
                tool: 'sheets_data',
                action: 'get_values',
                risk: 'low',
              },
            ],
          },
        });
      }

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'decline',
        content: {},
      } as any);

      await handler.handle({
        action: 'request',
        plan: {
          title: 'Plan declined',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'cancel',
        content: {},
      } as any);

      await handler.handle({
        action: 'request',
        plan: {
          title: 'Plan cancelled',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      const result = await handler.handle({
        action: 'get_stats',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.stats?.totalConfirmations).toBe(5);
        expect(result.response.stats?.approved).toBe(3);
        expect(result.response.stats?.declined).toBe(1);
        expect(result.response.stats?.cancelled).toBe(1);
        expect(result.response.stats?.approvalRate).toBe(60);
      }
    });
  });

  describe('schema validation', () => {
    it('should validate output schema for successful request', async () => {
      vi.mocked(mockContext.server!.getClientCapabilities).mockReturnValue({
        elicitation: true,
      } as any);

      vi.mocked(mockContext.server!.elicitInput).mockResolvedValue({
        action: 'accept',
        content: { approved: true },
      } as any);

      const result = await handler.handle({
        action: 'request',
        plan: {
          title: 'Test Plan',
          description: 'Test description',
          steps: [
            {
              stepNumber: 1,
              description: 'Step 1',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
              estimatedApiCalls: 1,
            },
          ],
        },
      });

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.data).toEqual(result);
      }
    });

    it('should validate output schema for get_stats', async () => {
      const result = await handler.handle({
        action: 'get_stats',
      });

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should apply default empty message for success responses missing message', () => {
      const parsed = SheetsConfirmOutputSchema.parse({
        response: {
          success: true,
          action: 'request',
        },
      });

      expect(parsed.response.success).toBe(true);
      if (parsed.response.success) {
        expect(parsed.response.message).toBe('');
      }
    });

    it('should validate output schema for errors', async () => {
      const contextWithoutServer = createMockContext({ server: undefined });
      const handlerWithoutServer = new ConfirmHandler({ context: contextWithoutServer });

      const result = await handlerWithoutServer.handle({
        action: 'request',
        plan: {
          title: 'Test',
          description: 'Test',
          steps: [
            {
              stepNumber: 1,
              description: 'Step',
              tool: 'sheets_data',
              action: 'get_values',
              risk: 'low',
            },
          ],
        },
      });

      const parseResult = SheetsConfirmOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });
});
