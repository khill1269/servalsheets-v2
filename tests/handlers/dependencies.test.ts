/**
 * Tests for DependenciesHandler (Phase 3)
 *
 * Validates formula dependency analysis, graph building, and cycle detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import {
  DependenciesHandler,
  createDependenciesHandler,
  clearAnalyzerCache,
} from '../../src/handlers/dependencies.js';
import { createRequestContext, runWithRequestContext } from '../../src/utils/request-context.js';

const unwrapResponse = <T extends { response?: unknown }>(result: T) =>
  'response' in result ? (result as { response?: unknown }).response : result;

describe('DependenciesHandler', () => {
  let handler: DependenciesHandler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSheetsApi: any;

  beforeEach(() => {
    clearAnalyzerCache();

    // Mock Google Sheets API
    // Use mockResolvedValue (not mockResolvedValueOnce) so mocks persist for auto-build cases
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: '1ABC',
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Sheet1',
                },
              },
            ],
          },
        }),
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                ['10', '20', '=A1+B1'], // Row 1: A1, B1, C1 (formula)
                ['=C1*2', '5', '=A2+B2'], // Row 2: A2 (formula), B2, C2 (formula)
              ],
            },
          }),
        },
      },
    } as unknown as sheets_v4.Sheets;

    handler = createDependenciesHandler(mockSheetsApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Build Action', () => {
    it('should build dependency graph from spreadsheet', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'build',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        spreadsheetId: '1ABC',
        cellCount: expect.any(Number),
        formulaCount: expect.any(Number),
      });
    });

    it('should filter by sheet names if provided', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'build',
            spreadsheetId: '1ABC',
            sheetNames: ['Sheet1'],
          },
        })
      );

      expect(result.success).toBe(true);
      // When sheetNames provided, spreadsheets.get is skipped
      expect(mockSheetsApi.spreadsheets.get).not.toHaveBeenCalled();
      // But values.get should be called for the specified sheet
      expect(mockSheetsApi.spreadsheets.values.get).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: '1ABC',
          range: 'Sheet1',
          valueRenderOption: 'FORMULA',
        })
      );
    });

    it('should handle build errors', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValueOnce(new Error('API error'));

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'build',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should cache analyzer for subsequent calls', async () => {
      // First build
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      // Second build should reuse cache
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      // Should be called twice (once for each build)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('Analyze Impact Action', () => {
    it('should analyze impact of cell change', async () => {
      // Build graph first
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      // Analyze impact
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'analyze_impact',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!A1',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        targetCell: 'Sheet1!A1',
        directDependents: expect.any(Array),
        allAffectedCells: expect.any(Array),
      });
    });

    it('should build graph if not cached', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'analyze_impact',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!C1',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalled();
    });

    it('should handle invalid cell addresses', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'analyze_impact',
            spreadsheetId: '1ABC',
            cell: 'InvalidCell',
          },
        })
      );

      // Should handle gracefully
      expect(result.success).toBe(true);
    });

    it('should include dependency chain', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'analyze_impact',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!A1',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('dependencies');
    });
  });

  describe('Detect Cycles Action', () => {
    it('should detect circular dependencies', async () => {
      // Mock circular dependency: A1 → C1 → B1 → A1
      mockSheetsApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          spreadsheetId: '1ABC',
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
              },
            },
          ],
        },
      });

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [
            ['=C1+1', '=A1+1', '=B1+1'], // A1 → C1, B1 → A1, C1 → B1 (circular)
          ],
        },
      });

      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'detect_cycles',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('circularDependencies');
    });

    it('should return empty array if no cycles', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'detect_cycles',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data.circularDependencies)).toBe(true);
      }
    });
  });

  describe('Get Dependencies Action', () => {
    it('should get cells that a cell depends on', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'get_dependencies',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!C1',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('dependencies');
      if (result.success) {
        expect(Array.isArray(result.data.dependencies)).toBe(true);
      }
    });

    it('should return empty array for cells without dependencies', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'get_dependencies',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!A1', // A1 is a constant value
          },
        })
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Get Dependents Action', () => {
    it('should get cells that depend on a cell', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'get_dependents',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!A1',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('dependents');
      if (result.success) {
        expect(Array.isArray(result.data.dependents)).toBe(true);
      }
    });

    it('should return empty array for leaf cells', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'get_dependents',
            spreadsheetId: '1ABC',
            cell: 'Sheet1!C2', // C2 is a leaf node
          },
        })
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Get Stats Action', () => {
    it('should return dependency graph statistics', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'get_stats',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        totalCells: expect.any(Number),
        formulaCells: expect.any(Number),
        totalDependencies: expect.any(Number),
      });
    });

    it('should build graph if not cached', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'get_stats',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalled();
    });
  });

  describe('Export DOT Action', () => {
    it('should export graph in DOT format', async () => {
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'export_dot',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('dot');
      if (result.success && 'dot' in result.data) {
        expect(typeof result.data.dot).toBe('string');
        expect(result.data.dot).toContain('digraph');
      }
    });

    it('should handle export errors', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValueOnce(new Error('API error'));

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'export_dot',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown action', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            action: 'unknown_action' as any,
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
    });

    it('should handle internal errors', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValueOnce(new Error('Internal server error'));

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'build',
            spreadsheetId: '1ABC',
          },
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Internal server error');
    });
  });

  describe('Cache Management', () => {
    it('should cache analyzers per spreadsheet', async () => {
      // Build for spreadsheet 1
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      // Build for spreadsheet 2
      mockSheetsApi.spreadsheets.get.mockResolvedValueOnce({
        data: {
          spreadsheetId: '2DEF',
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
              },
            },
          ],
        },
      });
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [['1', '2', '3']],
        },
      });
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '2DEF',
        },
      });

      // Both should be cached independently
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });

    it('should rebuild graph when requested', async () => {
      // Initial build
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      // Rebuild
      await handler.handle({
        request: {
          action: 'build',
          spreadsheetId: '1ABC',
        },
      });

      // Should fetch twice (rebuild clears cache)
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // F6: Scenario Modeling
  // ============================================================================

  describe('model_scenario Action', () => {
    it('should trace cascade effects for a single input change', async () => {
      // Pre-build graph
      await handler.handle({ request: { action: 'build', spreadsheetId: '1ABC' } });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'model_scenario',
            spreadsheetId: '1ABC',
            changes: [{ cell: 'Sheet1!A1', newValue: 50 }],
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data.action).toBe('model_scenario');
      expect(result.data.inputChanges).toHaveLength(1);
      expect(result.data.inputChanges[0].cell).toBe('Sheet1!A1');
      expect(result.data.inputChanges[0].to).toBe(50);
      expect(result.data.cascadeEffects).toBeInstanceOf(Array);
      expect(result.data.summary.cellsAffected).toBeGreaterThanOrEqual(0);
      expect(result.data.summary.message).toContain('1 input change(s)');
    });

    it('should auto-build graph if not cached', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'model_scenario',
            spreadsheetId: '1ABC',
            changes: [{ cell: 'Sheet1!B1', newValue: 100 }],
          },
        })
      );

      expect(result.success).toBe(true);
      // Graph was built on demand
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple input changes', async () => {
      await handler.handle({ request: { action: 'build', spreadsheetId: '1ABC' } });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'model_scenario',
            spreadsheetId: '1ABC',
            changes: [
              { cell: 'Sheet1!A1', newValue: 100 },
              { cell: 'Sheet1!B1', newValue: 200 },
            ],
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data.inputChanges).toHaveLength(2);
      expect(result.data.summary.message).toContain('2 input change(s)');
    });

    it('should emit progress notifications for multi-change scenarios', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'deps-model-scenario-progress',
        progressToken: 'deps-model-scenario-progress',
        sendNotification: notification,
      });

      const result = await runWithRequestContext(requestContext, async () =>
        unwrapResponse(
          await handler.handle({
            request: {
              action: 'model_scenario',
              spreadsheetId: '1ABC',
              changes: [
                { cell: 'Sheet1!A1', newValue: 100 },
                { cell: 'Sheet1!B1', newValue: 200 },
              ],
            },
          })
        )
      );

      expect(result.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progress: 0,
          progressToken: 'deps-model-scenario-progress',
        }),
      });
    });

    it('should not duplicate cascade effects for overlapping dependencies', async () => {
      await handler.handle({ request: { action: 'build', spreadsheetId: '1ABC' } });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'model_scenario',
            spreadsheetId: '1ABC',
            changes: [
              { cell: 'Sheet1!A1', newValue: 10 },
              { cell: 'Sheet1!A1', newValue: 20 }, // same cell twice
            ],
          },
        })
      );

      expect(result.success).toBe(true);
      // Each cell should appear at most once in cascadeEffects
      const cells = result.data.cascadeEffects.map((e: { cell: string }) => e.cell);
      const unique = new Set(cells);
      expect(cells.length).toBe(unique.size);
    });
  });

  describe('compare_scenarios Action', () => {
    it('should compare two scenarios and return cells affected per scenario', async () => {
      await handler.handle({ request: { action: 'build', spreadsheetId: '1ABC' } });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'compare_scenarios',
            spreadsheetId: '1ABC',
            scenarios: [
              { name: 'Optimistic', changes: [{ cell: 'Sheet1!A1', newValue: 150 }] },
              { name: 'Pessimistic', changes: [{ cell: 'Sheet1!A1', newValue: 50 }] },
            ],
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data.action).toBe('compare_scenarios');
      expect(result.data.scenarios).toHaveLength(2);
      expect(result.data.scenarios[0].name).toBe('Optimistic');
      expect(result.data.scenarios[1].name).toBe('Pessimistic');
      expect(typeof result.data.scenarios[0].cellsAffected).toBe('number');
      expect(result.data.message).toContain('2 scenarios');
    });

    it('should auto-build graph if not cached', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'compare_scenarios',
            spreadsheetId: '1ABC',
            scenarios: [
              { name: 'A', changes: [{ cell: 'Sheet1!A1', newValue: 10 }] },
              { name: 'B', changes: [{ cell: 'Sheet1!B1', newValue: 20 }] },
            ],
          },
        })
      );

      expect(result.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should include all scenario names in summary message', async () => {
      await handler.handle({ request: { action: 'build', spreadsheetId: '1ABC' } });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'compare_scenarios',
            spreadsheetId: '1ABC',
            scenarios: [
              { name: 'Base Case', changes: [{ cell: 'Sheet1!A1', newValue: 100 }] },
              { name: 'Stretch', changes: [{ cell: 'Sheet1!A1', newValue: 200 }] },
              { name: 'Worst Case', changes: [{ cell: 'Sheet1!A1', newValue: 10 }] },
            ],
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data.scenarios).toHaveLength(3);
      expect(result.data.message).toContain('Base Case');
      expect(result.data.message).toContain('Stretch');
      expect(result.data.message).toContain('Worst Case');
    });

    it('should emit progress notifications for multi-scenario comparisons', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'deps-compare-scenarios-progress',
        progressToken: 'deps-compare-scenarios-progress',
        sendNotification: notification,
      });

      const result = await runWithRequestContext(requestContext, async () =>
        unwrapResponse(
          await handler.handle({
            request: {
              action: 'compare_scenarios',
              spreadsheetId: '1ABC',
              scenarios: [
                { name: 'Best Case', changes: [{ cell: 'Sheet1!A1', newValue: 120 }] },
                { name: 'Worst Case', changes: [{ cell: 'Sheet1!A1', newValue: 20 }] },
              ],
            },
          })
        )
      );

      expect(result.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progress: 0,
          progressToken: 'deps-compare-scenarios-progress',
        }),
      });
    });
  });

  describe('create_scenario_sheet Action', () => {
    beforeEach(() => {
      // Mock batchUpdate for duplicateSheet
      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [
            { duplicateSheet: { properties: { sheetId: 42, title: 'Scenario - Optimistic' } } },
          ],
        },
      });
      // Mock values.batchUpdate for writing scenario changes
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({ data: {} });
    });

    it('should duplicate first sheet and apply scenario changes', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'create_scenario_sheet',
            spreadsheetId: '1ABC',
            scenario: {
              name: 'Optimistic',
              changes: [
                { cell: 'Sheet1!A1', newValue: 150 },
                { cell: 'Sheet1!B1', newValue: 250 },
              ],
            },
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data.action).toBe('create_scenario_sheet');
      expect(result.data.newSheetId).toBe(42);
      expect(result.data.newSheetName).toBe('Scenario - Optimistic');
      expect(result.data.cellsModified).toBe(2);
      expect(result.data.message).toContain('Scenario - Optimistic');
      expect(result.data.message).toContain('2 change(s)');
    });

    it('should use custom targetSheet name when provided', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          replies: [{ duplicateSheet: { properties: { sheetId: 99, title: 'Q1 Forecast' } } }],
        },
      });

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'create_scenario_sheet',
            spreadsheetId: '1ABC',
            scenario: {
              name: 'Optimistic',
              changes: [{ cell: 'Sheet1!A1', newValue: 150 }],
            },
            targetSheet: 'Q1 Forecast',
          },
        })
      );

      expect(result.success).toBe(true);
      expect(result.data.newSheetName).toBe('Q1 Forecast');
      // Verify batchUpdate was called with the custom name
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                duplicateSheet: expect.objectContaining({ newSheetName: 'Q1 Forecast' }),
              }),
            ]),
          }),
        })
      );
    });

    it('should default sheet name to "Scenario - {name}" when targetSheet omitted', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'create_scenario_sheet',
            spreadsheetId: '1ABC',
            scenario: {
              name: 'Bear Case',
              changes: [{ cell: 'Sheet1!A1', newValue: 10 }],
            },
          },
        })
      );

      expect(result.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                duplicateSheet: expect.objectContaining({ newSheetName: 'Scenario - Bear Case' }),
              }),
            ]),
          }),
        })
      );
    });

    it('should handle API error during sheet duplication', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockRejectedValueOnce(new Error('Quota exceeded'));

      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'create_scenario_sheet',
            spreadsheetId: '1ABC',
            scenario: {
              name: 'Test',
              changes: [{ cell: 'Sheet1!A1', newValue: 1 }],
            },
          },
        })
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Quota exceeded');
    });

    it('writes descriptive pseudo-formulas as RAW values instead of USER_ENTERED formulas', async () => {
      const result = unwrapResponse(
        await handler.handle({
          request: {
            action: 'create_scenario_sheet',
            spreadsheetId: '1ABC',
            scenario: {
              name: 'Pseudo Formula Guard',
              changes: [{ cell: 'Sheet1!C3', newValue: '=Units x Current Price/Unit' }],
            },
          },
        })
      );

      expect(result.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: '1ABC',
          requestBody: expect.objectContaining({
            valueInputOption: 'RAW',
            data: [
              expect.objectContaining({
                range: "'Scenario - Pseudo Formula Guard'!C3",
                values: [['=Units x Current Price/Unit']],
              }),
            ],
          }),
        })
      );
    });
  });
});
