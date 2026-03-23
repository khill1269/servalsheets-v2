import { describe, expect, it } from 'vitest';
import { generateAllFixtures, type ActionFixture } from '../audit/action-coverage-fixtures.js';
import {
  MATRIX_ACTION_OVERRIDES,
  MATRIX_TOOL_DEFAULTS,
  buildMatrixExecutionProfile,
  buildActionCapabilityIndex,
  findStaleActionKeys,
  isMatrixTimeoutRetrySafe,
  materializeFixtureRequest,
  summarizeMatrixResults,
  type MatrixActionResult,
} from '../live-api/action-matrix-support.js';

describe('Action Matrix Support', () => {
  it('materializes nested spreadsheet placeholders inside the request envelope', () => {
    const fixture = {
      validInput: {
        request: {
          action: 'cross_write',
          spreadsheetId: 'test-id',
          sheetId: 0,
          spreadsheetIds: ['id1', 'id2'],
          source: {
            spreadsheetId: 'src-id',
            range: 'Sheet1!A1:D10',
          },
          destination: {
            spreadsheetId: 'dest-id',
            range: 'Sheet1!A1',
            anchor: {
              sheetId: 0,
            },
          },
        },
      },
    } as Pick<ActionFixture, 'validInput'>;

    const materialized = materializeFixtureRequest(fixture, {
      primarySpreadsheetId: 'sheet-primary',
      primarySheetId: 42,
      secondarySpreadsheetId: 'sheet-secondary',
      secondarySheetId: 84,
    });

    expect(materialized).toEqual({
      request: {
        action: 'cross_write',
        spreadsheetId: 'sheet-primary',
        sheetId: 42,
        spreadsheetIds: ['sheet-primary', 'sheet-secondary'],
        source: {
          spreadsheetId: 'sheet-primary',
          range: 'Sheet1!A1:D10',
        },
        destination: {
          spreadsheetId: 'sheet-secondary',
          range: 'Sheet1!A1',
          anchor: {
            sheetId: 42,
          },
        },
      },
    });
  });

  it('applies matrix-specific request normalization for setup-dependent live actions', () => {
    const options = {
      primarySpreadsheetId: 'sheet-primary',
      primarySheetId: 42,
      secondarySpreadsheetId: 'sheet-secondary',
      secondarySheetId: 84,
    };

    expect(
      materializeFixtureRequest(
        {
          tool: 'sheets_advanced',
          validInput: {
            request: {
              action: 'add_named_range',
              spreadsheetId: 'test-id',
              name: 'TestRange',
              range: 'Sheet1!A1:B10',
            },
          },
        } as Pick<ActionFixture, 'tool' | 'validInput'>,
        options
      )
    ).toEqual({
      request: {
        action: 'add_named_range',
        spreadsheetId: 'sheet-primary',
        name: 'MatrixAddedRange',
        range: 'Sheet1!A1:B10',
      },
    });

    expect(
      materializeFixtureRequest(
        {
          tool: 'sheets_format',
          validInput: {
            request: {
              action: 'list_data_validations',
              spreadsheetId: 'test-id',
              sheetId: 0,
            },
          },
        } as Pick<ActionFixture, 'tool' | 'validInput'>,
        options
      )
    ).toEqual({
      request: {
        action: 'list_data_validations',
        spreadsheetId: 'sheet-primary',
        sheetId: 42,
        range: 'Sheet1!E2:E6',
      },
    });

    expect(
      materializeFixtureRequest(
        {
          tool: 'sheets_format',
          validInput: {
            request: {
              action: 'build_dependent_dropdown',
              spreadsheetId: 'test-id',
              parentRange: 'Sheet1!A2:A100',
              dependentRange: 'Sheet1!B2:B100',
              lookupSheet: 'Lookup',
            },
          },
        } as Pick<ActionFixture, 'tool' | 'validInput'>,
        options
      )
    ).toEqual({
      request: {
        action: 'build_dependent_dropdown',
        spreadsheetId: 'sheet-primary',
        parentRange: 'Sheet1!A2:A6',
        dependentRange: 'Sheet1!B2:B6',
        lookupSheet: 'Lookup',
      },
    });
  });

  it('classifies every fixture exactly once with complete tool coverage', () => {
    const fixtures = generateAllFixtures();
    const capabilityIndex = buildActionCapabilityIndex(fixtures);
    const fixtureTools = [...new Set(fixtures.map((fixture) => fixture.tool))].sort();
    const policyTools = Object.keys(MATRIX_TOOL_DEFAULTS).sort();

    expect(capabilityIndex.size).toBe(fixtures.length);
    expect(policyTools).toEqual(fixtureTools);

    const modeCounts = [...capabilityIndex.values()].reduce(
      (counts, capability) => {
        counts[capability.mode] += 1;
        return counts;
      },
      { mcp_execute: 0, probe_only: 0, skip_external: 0 }
    );

    expect(modeCounts.mcp_execute).toBeGreaterThan(0);
    expect(modeCounts.probe_only).toBeGreaterThan(0);
    expect(modeCounts.skip_external).toBeGreaterThan(0);
    expect(modeCounts.mcp_execute + modeCounts.probe_only + modeCounts.skip_external).toBe(
      fixtures.length
    );
  });

  it('keeps action overrides in sync with the generated fixture set', () => {
    const fixtures = generateAllFixtures();
    const staleOverrides = findStaleActionKeys(Object.keys(MATRIX_ACTION_OVERRIDES), fixtures);

    expect(staleOverrides).toEqual([]);
  });

  it('routes heavyweight copy coverage through probe mode instead of the executed lane', () => {
    const capabilityIndex = buildActionCapabilityIndex(generateAllFixtures());
    const copyCapability = capabilityIndex.get('sheets_core.copy');

    expect(copyCapability?.mode).toBe('probe_only');
    expect(copyCapability?.assertionSource).toBe('google_probe');
  });

  it('builds execution profiles with slow lanes for high-latency actions', () => {
    const clearSheetProfile = buildMatrixExecutionProfile('sheets_core.clear_sheet', 'mcp_execute', true);
    const clearProfile = buildMatrixExecutionProfile('sheets_data.clear', 'mcp_execute', true);
    const readProfile = buildMatrixExecutionProfile('sheets_data.read', 'mcp_execute', false);
    const probeProfile = buildMatrixExecutionProfile(
      'sheets_visualize.suggest_chart',
      'probe_only',
      false
    );

    expect(clearSheetProfile.maxAttempts).toBe(3);
    expect(clearSheetProfile.retryTransportTimeout).toBe(true);
    expect(clearSheetProfile.quotaEstimate).toEqual({ reads: 2, writes: 1 });

    expect(clearProfile.retryTransportTimeout).toBe(true);
    expect(clearProfile.quotaEstimate).toEqual({ reads: 1, writes: 1 });
    expect(clearProfile.callTimeoutMs).toBe(570_000);
    expect(clearProfile.maxTotalTimeoutMs).toBe(600_000);

    expect(readProfile.retryTransportTimeout).toBe(true);
    expect(readProfile.maxAttempts).toBe(3);
    expect(readProfile.quotaEstimate).toEqual({ reads: 2, writes: 0 });

    expect(probeProfile.maxAttempts).toBe(1);
    expect(probeProfile.quotaEstimate).toEqual({ reads: 1, writes: 0 });
  });

  it('marks only idempotent or explicitly safe actions as timeout-retryable', () => {
    expect(isMatrixTimeoutRetrySafe('sheets_data.read', false)).toBe(true);
    expect(isMatrixTimeoutRetrySafe('sheets_data.clear', true)).toBe(true);
    expect(isMatrixTimeoutRetrySafe('sheets_core.copy', true)).toBe(false);
  });

  it('summarizes report counts without mixing skipped actions into the pass rate', () => {
    const results: MatrixActionResult[] = [
      {
        tool: 'sheets_core',
        action: 'get',
        actionKey: 'sheets_core.get',
        mode: 'mcp_execute',
        assertionSource: 'mcp_tool',
        reason: 'executed',
        success: true,
        gated: true,
        latencyMs: 10,
      },
      {
        tool: 'sheets_data',
        action: 'write',
        actionKey: 'sheets_data.write',
        mode: 'mcp_execute',
        assertionSource: 'mcp_tool',
        reason: 'executed',
        success: false,
        gated: true,
        latencyMs: 20,
        errorCode: 'INTERNAL_ERROR',
      },
      {
        tool: 'sheets_collaborate',
        action: 'share_list',
        actionKey: 'sheets_collaborate.share_list',
        mode: 'probe_only',
        assertionSource: 'google_probe',
        reason: 'probe',
        success: true,
        gated: true,
        latencyMs: 30,
        httpStatus: 200,
      },
      {
        tool: 'sheets_bigquery',
        action: 'connect',
        actionKey: 'sheets_bigquery.connect',
        mode: 'skip_external',
        assertionSource: 'skip_policy',
        reason: 'skip',
        success: false,
        gated: false,
        skipped: true,
        latencyMs: 0,
      },
    ];

    const summary = summarizeMatrixResults(results, '2026-03-15T00:00:00.000Z', 1234);

    expect(summary.totalActions).toBe(4);
    expect(summary.executed).toBe(2);
    expect(summary.probed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.gatedActions).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.passRate).toBe('66.7%');
  });
});
