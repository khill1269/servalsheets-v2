import { describe, expect, it } from 'vitest';
import { applyResponseIntelligence } from '../../src/mcp/registration/response-intelligence.js';

describe('applyResponseIntelligence', () => {
  it('adds suggested fixes for failure responses', () => {
    const responseRecord: Record<string, unknown> = {
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'User does not have access',
      },
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: true,
    });

    const error = responseRecord['error'] as Record<string, unknown>;
    // suggestedFix is now the full fix object {tool, action, params, explanation}
    expect(typeof error['suggestedFix']).toBe('object');
    expect(error['suggestedFix']).toEqual(
      expect.objectContaining({ tool: 'sheets_auth', action: 'login' })
    );
    // fixableVia is the structured recovery action
    expect(error['fixableVia']).toEqual(
      expect.objectContaining({
        tool: 'sheets_auth',
        action: 'login',
      })
    );
  });

  it('adds data-aware suggestions and quality warnings from nested values', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      action: 'read',
      range: 'Sheet1!A1:D5',
      data: {
        values: [
          ['Date', 'Amount', 'Lookup', 'Notes'],
          ['2026-01-03', 100, '=VLOOKUP(A2,Lookup!A:B,2,FALSE)', null],
          ['2026-01-01', 200, '=VLOOKUP(A3,Lookup!A:B,2,FALSE)', 'ok'],
          ['2026-01-02', '', '=VLOOKUP(A4,Lookup!A:B,2,FALSE)', null],
          ['2026-01-04', 150, '=VLOOKUP(A5,Lookup!A:B,2,FALSE)', null],
        ],
      },
      confidence: {
        gaps: ['Missing column type info'],
      },
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    expect(responseRecord['suggestedNextActions']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'sheets_visualize', action: 'suggest_chart' }),
        expect.objectContaining({ tool: 'sheets_analyze', action: 'analyze_formulas' }),
        expect.objectContaining({ tool: 'sheets_dimensions', action: 'sort_range' }),
        expect.objectContaining({ tool: 'sheets_fix', action: 'fill_missing' }),
        expect.objectContaining({ tool: 'sheets_analyze', action: 'analyze_data' }),
      ])
    );
    expect(responseRecord['dataQualityWarnings']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'empty_required_cells',
          column: 'Notes',
          fixAction: expect.objectContaining({
            tool: 'sheets_fix',
            action: 'fill_missing',
            params: expect.objectContaining({
              action: 'fill_missing',
              range: 'Sheet1!A1:D5',
            }),
          }),
        }),
      ])
    );
  });

  it('does not inject recommendations when the action is missing', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      values: [['A'], ['B']],
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    expect(responseRecord['suggestedNextActions']).toBeUndefined();
    expect(responseRecord['dataQualityWarnings']).toBeUndefined();
  });

  // ─── _hints integration (Session 82 CoT layer) ──────────────────────────────

  it('injects _hints on sheets_data.read with 2D cell values', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      action: 'read',
      range: 'Sheet1!A1:D8',
      values: [
        ['Date', 'Revenue', 'Cost', 'Units'],
        ['2024-01-01', 12500, 7800, 142],
        ['2024-01-02', 13200, 8100, 156],
        ['2024-01-03', 11800, 7200, 138],
        ['2024-01-04', 14500, 8900, 167],
        ['2024-01-05', 15200, 9300, 175],
        ['2024-01-06', 13900, 8500, 160],
        ['2024-01-07', 16100, 9800, 182],
      ],
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    expect(responseRecord['_hints']).toBeDefined();
    const hints = responseRecord['_hints'] as Record<string, unknown>;

    // Shape detection
    expect(typeof hints['dataShape']).toBe('string');
    expect(hints['dataShape']).toMatch(/time series/);

    // Risk assessment always present
    expect(['none', 'low', 'medium', 'high']).toContain(hints['riskLevel']);

    // Workflow phase always a string
    expect(typeof hints['nextPhase']).toBe('string');
    expect((hints['nextPhase'] as string).length).toBeGreaterThan(0);
  });

  it('injects _hints on sheets_data.batch_read with nested data.values', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      action: 'batch_read',
      data: {
        values: [
          ['Name', 'Score'],
          ['Alice', 95],
          ['Bob', 87],
          ['Charlie', 92],
        ],
      },
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    // _hints injected for extractable grid values
    expect(responseRecord['_hints']).toBeDefined();
  });

  it('injects _hints on sheets_data.cross_read', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      action: 'cross_read',
      values: [
        ['Product', 'Revenue', 'Cost'],
        ['Widget A', 50000, 32000],
        ['Widget B', 45000, 28000],
        ['Widget C', 62000, 38000],
      ],
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    expect(responseRecord['_hints']).toBeDefined();
    const hints = responseRecord['_hints'] as Record<string, unknown>;
    // Revenue + Cost columns → profit margin relationship
    const relationships = hints['dataRelationships'] as string[] | undefined;
    if (relationships) {
      const hasProfit = relationships.some(
        (r) => r.toLowerCase().includes('profit') || r.toLowerCase().includes('margin')
      );
      expect(hasProfit).toBe(true);
    }
  });

  it('injects verifyWrite _hints for sheets_data.write responses', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      action: 'write',
      updatedCells: 4,
      updatedRange: 'Sheet1!A1:B2',
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: false,
      spreadsheetId: 'abc123',
    });

    // Write responses now get verifyWrite hint for read-back verification
    const hints = responseRecord['_hints'] as Record<string, unknown>;
    expect(hints).toBeDefined();
    expect(hints['verifyWrite']).toEqual(
      expect.objectContaining({
        tool: 'sheets_data',
        action: 'read',
        params: expect.objectContaining({
          spreadsheetId: 'abc123',
          range: 'Sheet1!A1:B2',
        }),
      })
    );
  });

  it('does NOT inject _hints for other tools (format, analyze, etc.)', () => {
    const responseRecord: Record<string, unknown> = {
      success: true,
      action: 'set_background',
      values: [['incidental values']],
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_format',
      hasFailure: false,
    });

    expect(responseRecord['_hints']).toBeUndefined();
  });

  it('_hints absent when response has failure', () => {
    const responseRecord: Record<string, unknown> = {
      success: false,
      action: 'read',
      values: [['Name', 'Revenue'], ['Alice', 1000]],
      error: { code: 'PERMISSION_DENIED', message: 'Access denied' },
    };

    applyResponseIntelligence(responseRecord, {
      toolName: 'sheets_data',
      hasFailure: true,
    });

    // Failure path — _hints not injected
    expect(responseRecord['_hints']).toBeUndefined();
    // suggestedFix (object) and fixableVia (structured) should be on the error
    const error = responseRecord['error'] as Record<string, unknown>;
    expect(typeof error['suggestedFix']).toBe('object');
    expect(error['fixableVia']).toEqual(
      expect.objectContaining({ tool: 'sheets_auth', action: 'login' })
    );
  });
});
