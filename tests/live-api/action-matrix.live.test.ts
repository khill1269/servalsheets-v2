/**
 * ServalSheets — Live API Action Matrix
 *
 * Executes a hybrid action matrix across all fixtures:
 * - runnable actions use live in-memory MCP execution
 * - risky/stateful actions use explicit lightweight probes
 * - external-infrastructure actions are skipped with machine-readable reasons
 *
 * Results are written to tests/benchmarks/action-matrix-v2-{timestamp}.json.
 *
 * Run: TEST_REAL_API=true npm run test:matrix
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { resetEnvForTest } from '../../src/config/env.js';
import { createServalSheetsTestHarness, type McpTestHarness } from '../helpers/mcp-test-harness.js';
import {
  loadTestCredentials,
  shouldRunIntegrationTests,
  type TestCredentials,
} from '../helpers/credential-loader.js';
import {
  generateAllFixtures,
  type ActionFixture,
} from '../audit/action-coverage-fixtures.js';
import { LiveApiClient } from './setup/live-api-client.js';
import { TestSpreadsheetManager } from './setup/test-spreadsheet-manager.js';
import { getQuotaManager } from './setup/quota-manager.js';
import {
  buildActionCapabilityIndex,
  materializeFixtureRequest,
  summarizeMatrixResults,
  type ActionCapability,
  type MaterializeRequestOptions,
  type MatrixActionResult,
} from './action-matrix-support.js';

const runLiveTests = shouldRunIntegrationTests();
const MATRIX_FIXTURES = generateAllFixtures();
const CAPABILITY_INDEX = buildActionCapabilityIndex(MATRIX_FIXTURES);
const DELAY_BETWEEN_ACTIONS_MS = 1100;
const RATE_LIMIT_FALLBACK_DELAY_MS = 60_000;
const TRANSPORT_TIMEOUT_RETRY_DELAY_MS = 20_000;
const PREVIOUS_SINGLETON_RESET_FLAG = process.env['TEST_SKIP_SINGLETON_RESET'];
const PREVIOUS_GOOGLE_API_TIMEOUT_MS = process.env['GOOGLE_API_TIMEOUT_MS'];
const PREVIOUS_COMPOSITE_TIMEOUT_MS = process.env['COMPOSITE_TIMEOUT_MS'];

interface MatrixSpreadsheet {
  id: string;
  title: string;
  sheetId: number;
}

interface MatrixExecutionContext {
  primary: MatrixSpreadsheet;
  secondary?: MatrixSpreadsheet;
}

interface ParsedMcpOutcome {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  mcpError?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    category?: string;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAcceptableToolFailure(actionKey: string, outcome: ParsedMcpOutcome): boolean {
  return actionKey === 'sheets_quality.validate' && outcome.errorCode === 'VALIDATION_ERROR';
}

describe.skipIf(!runLiveTests)('Live API Action Matrix', () => {
  let credentials: TestCredentials;
  let client: LiveApiClient;
  let harness: McpTestHarness;
  let manager: TestSpreadsheetManager;
  let sharedContext: MatrixExecutionContext;
  let tempServiceAccountPath: string | null = null;
  let matrixCooldownUntil = 0;
  const results: MatrixActionResult[] = [];
  const startTime = Date.now();

  beforeAll(async () => {
    process.env['TEST_SKIP_SINGLETON_RESET'] = 'true';
    process.env['GOOGLE_API_TIMEOUT_MS'] = '540000';
    process.env['COMPOSITE_TIMEOUT_MS'] = '660000';
    resetEnvForTest();
    getQuotaManager().reset();
    getQuotaManager().resetStats();

    const loadedCredentials = await loadTestCredentials();
    if (!loadedCredentials) {
      throw new Error('Test credentials not available');
    }

    await refreshMatrixOAuthCredentials(loadedCredentials);
    credentials = loadedCredentials;
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);
    harness = await createMatrixHarness(credentials);
    tempServiceAccountPath = registeredTempServiceAccountPath;
    matrixCooldownUntil = 0;
    sharedContext = await createExecutionContext(client, manager, 'shared', true);
  }, 180_000);

  afterAll(async () => {
    const generatedAt = new Date().toISOString();
    const report = summarizeMatrixResults(results, generatedAt, Date.now() - startTime);
    const benchDir = path.resolve('tests/benchmarks');
    const timestamp = generatedAt.replace(/[:.]/g, '-');

    fs.mkdirSync(benchDir, { recursive: true });
    fs.writeFileSync(
      path.join(benchDir, `action-matrix-v2-${timestamp}.json`),
      JSON.stringify(report, null, 2)
    );

    console.log('\n═══════════════════════════════════════');
    console.log('Action Matrix Results (V2)');
    console.log('═══════════════════════════════════════');
    console.log(`Total:    ${report.totalActions}`);
    console.log(`Executed: ${report.executed}`);
    console.log(`Probed:   ${report.probed}`);
    console.log(`Skipped:  ${report.skipped}`);
    console.log(`Passed:   ${report.passed}`);
    console.log(`Failed:   ${report.failed}`);
    console.log(`Rate:     ${report.passRate}`);
    console.log(`Time:     ${(report.durationMs / 1000).toFixed(1)}s`);

    if (report.failed > 0) {
      console.log('\nFailed actions:');
      for (const result of report.results.filter((entry) => entry.gated && !entry.success)) {
        const detail =
          result.errorMessage ??
          result.transportError?.message ??
          result.mcpError?.message ??
          'No error details';
        console.log(`  ✗ ${result.actionKey} [${result.mode}] ${detail}`);
      }
    }

    await harness.close();
    await manager.cleanup();

    if (tempServiceAccountPath) {
      fs.rmSync(tempServiceAccountPath, { force: true });
      registeredTempServiceAccountPath = null;
    }

    if (PREVIOUS_SINGLETON_RESET_FLAG === undefined) {
      delete process.env['TEST_SKIP_SINGLETON_RESET'];
    } else {
      process.env['TEST_SKIP_SINGLETON_RESET'] = PREVIOUS_SINGLETON_RESET_FLAG;
    }

    if (PREVIOUS_GOOGLE_API_TIMEOUT_MS === undefined) {
      delete process.env['GOOGLE_API_TIMEOUT_MS'];
    } else {
      process.env['GOOGLE_API_TIMEOUT_MS'] = PREVIOUS_GOOGLE_API_TIMEOUT_MS;
    }

    if (PREVIOUS_COMPOSITE_TIMEOUT_MS === undefined) {
      delete process.env['COMPOSITE_TIMEOUT_MS'];
    } else {
      process.env['COMPOSITE_TIMEOUT_MS'] = PREVIOUS_COMPOSITE_TIMEOUT_MS;
    }

    resetEnvForTest();
  }, 90_000);

  const fixturesByTool = groupFixturesByTool(MATRIX_FIXTURES);

  for (const [tool, fixtures] of fixturesByTool) {
    describe(`${tool} (${fixtures.length} actions)`, () => {
      for (const fixture of fixtures) {
        const capability = CAPABILITY_INDEX.get(`${fixture.tool}.${fixture.action}`);

        it(
          fixture.action,
          async () => {
            if (!capability) {
              throw new Error(`Missing action capability for ${fixture.tool}.${fixture.action}`);
            }

            const result = await executeFixture(fixture, capability);
            results.push(result);
            await applyInterActionDelay(capability);

            expect(result.mode).toBe(capability.mode);
            expect(result.assertionSource).toBe(capability.assertionSource);
          },
          getFixtureTimeoutMs(capability)
        );
      }
    });
  }

  it('overall: action accounting matches fixture coverage', () => {
    const report = summarizeMatrixResults(results, new Date().toISOString(), Date.now() - startTime);

    expect(results).toHaveLength(MATRIX_FIXTURES.length);
    expect(report.executed + report.probed + report.skipped).toBe(MATRIX_FIXTURES.length);
  });

  it('overall: pass rate >= 95% for executed and probed actions', () => {
    const attempted = results.filter((result) => result.gated);
    const passed = attempted.filter((result) => result.success);
    const rate = attempted.length ? passed.length / attempted.length : 1;

    expect(
      rate,
      `Pass rate ${(rate * 100).toFixed(1)}% below 95% threshold. Failed: ${attempted
        .filter((result) => !result.success)
        .map((result) => result.actionKey)
        .join(', ')}`
    ).toBeGreaterThanOrEqual(0.95);
  });

  async function executeFixture(
    fixture: ActionFixture,
    capability: ActionCapability
  ): Promise<MatrixActionResult> {
    if (capability.mode === 'skip_external') {
      return {
        tool: fixture.tool,
        action: fixture.action,
        actionKey: capability.actionKey,
        mode: capability.mode,
        assertionSource: capability.assertionSource,
        reason: capability.reason,
        success: false,
        gated: false,
        skipped: true,
        latencyMs: 0,
        attemptCount: 0,
        retryCount: 0,
      };
    }

    await waitForExecutionSlot(capability);

    // probe_only actions only do lightweight reads (spreadsheets.get / values.get) — no need
    // for a dedicated context. Using shared context cuts ~300 API calls and avoids quota spikes.
    const useSharedContext =
      fixture.noSpreadsheet || capability.sharedExecution || capability.mode === 'probe_only';

    let executionContext: MatrixExecutionContext;
    try {
      executionContext = useSharedContext
        ? sharedContext
        : await createExecutionContext(
            client,
            manager,
            capability.actionKey.replace(/\W+/g, '-'),
            capability.requiresSecondarySpreadsheet
          );
    } catch (contextError) {
      // Context setup failed (e.g. quota exhausted) — record as a failure rather than throwing,
      // so the accounting assertion (results.length === fixtures.length) stays valid.
      const err = contextError instanceof Error ? contextError : new Error(String(contextError));
      return {
        tool: fixture.tool,
        action: fixture.action,
        actionKey: capability.actionKey,
        mode: capability.mode,
        assertionSource: capability.assertionSource,
        reason: capability.reason,
        success: false,
        gated: true,
        latencyMs: 0,
        errorCode: 'CONTEXT_SETUP_FAILED',
        errorMessage: err.message,
        attemptCount: 0,
        retryCount: 0,
      };
    }

    try {
      return capability.mode === 'mcp_execute'
        ? await executeMcpAction(fixture, capability, executionContext)
        : await executeProbe(fixture, capability, executionContext);
    } finally {
      if (!useSharedContext) {
        await cleanupExecutionContext(manager, executionContext);
      }
    }
  }

  async function executeMcpAction(
    fixture: ActionFixture,
    capability: ActionCapability,
    context: MatrixExecutionContext
  ): Promise<MatrixActionResult> {
    const requestEnvelope = materializeFixtureRequest(
      fixture,
      getMaterializeOptions(context)
    );

    const start = Date.now();
    const profile = capability.executionProfile;
    let attemptCount = 0;
    let lastFailure: MatrixActionResult | null = null;

    for (let attempt = 1; attempt <= profile.maxAttempts; attempt++) {
      attemptCount = attempt;

      try {
        const result = (await harness.client.callTool({
          name: fixture.tool,
          arguments: requestEnvelope,
        }, undefined, {
          timeout: profile.callTimeoutMs,
          maxTotalTimeout: profile.maxTotalTimeoutMs,
          resetTimeoutOnProgress: true,
        })) as CallToolResult;
        recordExecutionEstimate(capability);

        const parsed = parseMcpOutcome(result);
        const acceptedFailure = isAcceptableToolFailure(capability.actionKey, parsed);

        if (parsed.success || acceptedFailure) {
          return {
            tool: fixture.tool,
            action: fixture.action,
            actionKey: capability.actionKey,
            mode: capability.mode,
            assertionSource: capability.assertionSource,
            reason: capability.reason,
            success: true,
            gated: true,
            latencyMs: Date.now() - start,
            attemptCount,
            retryCount: attemptCount - 1,
          };
        }

        const failure: MatrixActionResult = {
          tool: fixture.tool,
          action: fixture.action,
          actionKey: capability.actionKey,
          mode: capability.mode,
          assertionSource: capability.assertionSource,
          reason: capability.reason,
          success: false,
          gated: true,
          latencyMs: Date.now() - start,
          errorCode: parsed.errorCode,
          errorMessage: parsed.errorMessage,
          attemptCount,
          retryCount: attemptCount - 1,
          mcpError: parsed.mcpError,
        };

        const retryDelayMs = resolveMcpRetryDelay(capability, parsed);
        if (retryDelayMs !== null && attempt < profile.maxAttempts) {
          lastFailure = failure;
          await waitForExecutionSlot(capability);
          continue;
        }

        return failure;
      } catch (error) {
        recordExecutionEstimate(capability);
        const transportError = normalizeTransportError(error);
        const failure: MatrixActionResult = {
          tool: fixture.tool,
          action: fixture.action,
          actionKey: capability.actionKey,
          mode: capability.mode,
          assertionSource: capability.assertionSource,
          reason: capability.reason,
          success: false,
          gated: true,
          latencyMs: Date.now() - start,
          errorCode: transportError.status ? String(transportError.status) : 'TRANSPORT_ERROR',
          errorMessage: transportError.message,
          attemptCount,
          retryCount: attemptCount - 1,
          transportError,
        };

        const retryDelayMs = resolveTransportRetryDelay(capability, transportError);
        if (retryDelayMs !== null && attempt < profile.maxAttempts) {
          lastFailure = failure;
          await waitForExecutionSlot(capability);
          continue;
        }

        return failure;
      }
    }

    return (
      lastFailure ?? {
        tool: fixture.tool,
        action: fixture.action,
        actionKey: capability.actionKey,
        mode: capability.mode,
        assertionSource: capability.assertionSource,
        reason: capability.reason,
        success: false,
        gated: true,
        latencyMs: Date.now() - start,
        errorCode: 'UNKNOWN_RETRY_FAILURE',
        errorMessage: 'Matrix retry loop exited without a terminal result',
        attemptCount,
        retryCount: Math.max(0, attemptCount - 1),
      }
    );
  }

  async function executeProbe(
    fixture: ActionFixture,
    capability: ActionCapability,
    context: MatrixExecutionContext
  ): Promise<MatrixActionResult> {
    const requestEnvelope = materializeFixtureRequest(
      fixture,
      getMaterializeOptions(context)
    );
    const request = requestEnvelope['request'] as Record<string, unknown>;
    const start = Date.now();

    try {
      const response = await runProbe(client, capability, request, context);
      recordExecutionEstimate(capability);

      return {
        tool: fixture.tool,
        action: fixture.action,
        actionKey: capability.actionKey,
        mode: capability.mode,
        assertionSource: capability.assertionSource,
        reason: capability.reason,
        success: response.status >= 200 && response.status < 400,
        gated: true,
        latencyMs: Date.now() - start,
        httpStatus: response.status,
        attemptCount: 1,
        retryCount: 0,
      };
    } catch (error) {
      recordExecutionEstimate(capability);
      const transportError = normalizeTransportError(error);

      return {
        tool: fixture.tool,
        action: fixture.action,
        actionKey: capability.actionKey,
        mode: capability.mode,
        assertionSource: capability.assertionSource,
        reason: capability.reason,
        success: false,
        gated: true,
        latencyMs: Date.now() - start,
        httpStatus: transportError.status,
        errorCode: transportError.status ? String(transportError.status) : 'PROBE_ERROR',
        errorMessage: transportError.message,
        attemptCount: 1,
        retryCount: 0,
        transportError,
      };
    }
  }

  async function waitForExecutionSlot(capability: ActionCapability): Promise<void> {
    await waitForMatrixCooldown();

    const { reads, writes } = capability.executionProfile.quotaEstimate;
    if (reads > 0 || writes > 0) {
      await getQuotaManager().waitForQuotaRecovery({ reads, writes });
    }
  }

  function recordExecutionEstimate(capability: ActionCapability): void {
    const { reads, writes } = capability.executionProfile.quotaEstimate;
    if (reads > 0 || writes > 0) {
      getQuotaManager().recordOperations(reads, writes);
    }
  }

  async function applyInterActionDelay(capability: ActionCapability): Promise<void> {
    if (capability.mode === 'skip_external') {
      return;
    }

    const delayMs = Math.max(
      DELAY_BETWEEN_ACTIONS_MS,
      capability.executionProfile.baseDelayMs,
      getQuotaManager().calculateRequiredDelay()
    );

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  function registerMatrixCooldown(delayMs: number): void {
    if (delayMs <= 0) {
      return;
    }

    matrixCooldownUntil = Math.max(matrixCooldownUntil, Date.now() + delayMs);

    if (delayMs >= RATE_LIMIT_FALLBACK_DELAY_MS) {
      getQuotaManager().enterThrottle(Math.min(delayMs, RATE_LIMIT_FALLBACK_DELAY_MS));
    }
  }

  async function waitForMatrixCooldown(): Promise<void> {
    const remainingMs = matrixCooldownUntil - Date.now();
    if (remainingMs > 0) {
      await sleep(remainingMs);
    }

    if (Date.now() >= matrixCooldownUntil) {
      matrixCooldownUntil = 0;
    }
  }

  function resolveMcpRetryDelay(
    capability: ActionCapability,
    parsed: ParsedMcpOutcome
  ): number | null {
    if (isRetryableRateLimitMcpOutcome(parsed) && capability.executionProfile.retryRateLimit) {
      const delayMs = parsed.mcpError?.retryAfterMs ?? RATE_LIMIT_FALLBACK_DELAY_MS;
      registerMatrixCooldown(delayMs);
      return delayMs;
    }

    if (isRetryableTimeoutMcpOutcome(parsed) && capability.executionProfile.retryTransportTimeout) {
      registerMatrixCooldown(TRANSPORT_TIMEOUT_RETRY_DELAY_MS);
      return TRANSPORT_TIMEOUT_RETRY_DELAY_MS;
    }

    return null;
  }

  function resolveTransportRetryDelay(
    capability: ActionCapability,
    transportError: { message: string; status?: number }
  ): number | null {
    if (!capability.executionProfile.retryTransportTimeout) {
      return null;
    }

    if (!isTransportTimeoutError(transportError)) {
      return null;
    }

    registerMatrixCooldown(TRANSPORT_TIMEOUT_RETRY_DELAY_MS);
    return TRANSPORT_TIMEOUT_RETRY_DELAY_MS;
  }
});

function groupFixturesByTool(fixtures: ActionFixture[]): Map<string, ActionFixture[]> {
  const grouped = new Map<string, ActionFixture[]>();

  for (const fixture of fixtures) {
    const entries = grouped.get(fixture.tool) ?? [];
    entries.push(fixture);
    grouped.set(fixture.tool, entries);
  }

  return grouped;
}

async function createMatrixHarness(credentials: TestCredentials): Promise<McpTestHarness> {
  const googleApiOptions = createHarnessGoogleApiOptions(credentials);

  return createServalSheetsTestHarness({
    serverOptions: {
      googleApiOptions,
    },
  });
}

function createHarnessGoogleApiOptions(credentials: TestCredentials) {
  if (credentials.serviceAccount) {
    const tempFilePath = path.join(
      os.tmpdir(),
      `servalsheets-action-matrix-${randomUUID()}.json`
    );

    fs.writeFileSync(tempFilePath, JSON.stringify(credentials.serviceAccount, null, 2));
    registerTempServiceAccountPath(tempFilePath);

    return {
      serviceAccountKeyPath: tempFilePath,
    };
  }

  if (credentials.oauth) {
    const scopes = credentials.oauth.tokens.scope
      ? credentials.oauth.tokens.scope.split(/\s+/).filter(Boolean)
      : undefined;

    return {
      credentials: {
        clientId: credentials.oauth.client_id,
        clientSecret: credentials.oauth.client_secret,
        redirectUri: credentials.oauth.redirect_uri,
      },
      accessToken: credentials.oauth.tokens.access_token,
      refreshToken: credentials.oauth.tokens.refresh_token,
      oauthTokens: {
        access_token: credentials.oauth.tokens.access_token,
        refresh_token: credentials.oauth.tokens.refresh_token,
        scope: credentials.oauth.tokens.scope,
        token_type: credentials.oauth.tokens.token_type,
      },
      scopes,
    };
  }

  throw new Error('No supported credential type found for MCP harness');
}

let registeredTempServiceAccountPath: string | null = null;

async function refreshMatrixOAuthCredentials(credentials: TestCredentials): Promise<void> {
  if (!credentials.oauth?.tokens.refresh_token) {
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    credentials.oauth.client_id,
    credentials.oauth.client_secret,
    credentials.oauth.redirect_uri
  );
  oauth2Client.setCredentials(credentials.oauth.tokens);

  const { credentials: refreshed } = await oauth2Client.refreshAccessToken();

  credentials.oauth.tokens = {
    ...credentials.oauth.tokens,
    access_token: refreshed.access_token ?? credentials.oauth.tokens.access_token,
    refresh_token: refreshed.refresh_token ?? credentials.oauth.tokens.refresh_token,
    scope: refreshed.scope ?? credentials.oauth.tokens.scope,
    token_type: refreshed.token_type ?? credentials.oauth.tokens.token_type,
    expiry_date: refreshed.expiry_date ?? credentials.oauth.tokens.expiry_date,
  };
}

function registerTempServiceAccountPath(filePath: string): void {
  registeredTempServiceAccountPath = filePath;
}

function getFixtureTimeoutMs(capability: ActionCapability): number {
  return capability.executionProfile.testTimeoutMs;
}

function getMaterializeOptions(context: MatrixExecutionContext): MaterializeRequestOptions {
  return {
    primarySpreadsheetId: context.primary.id,
    primarySheetId: context.primary.sheetId,
    secondarySpreadsheetId: context.secondary?.id,
    secondarySheetId: context.secondary?.sheetId,
  };
}

async function createExecutionContext(
  client: LiveApiClient,
  manager: TestSpreadsheetManager,
  label: string,
  requiresSecondarySpreadsheet: boolean
): Promise<MatrixExecutionContext> {
  const primary = await createMatrixSpreadsheet(client, manager, `${label}-primary`);

  return {
    primary,
    secondary: requiresSecondarySpreadsheet
      ? await createMatrixSpreadsheet(client, manager, `${label}-secondary`)
      : undefined,
  };
}

async function cleanupExecutionContext(
  manager: TestSpreadsheetManager,
  context: MatrixExecutionContext
): Promise<void> {
  const spreadsheetIds = new Set([context.primary.id, context.secondary?.id].filter(Boolean));

  for (const spreadsheetId of spreadsheetIds) {
    await manager.deleteSpreadsheet(spreadsheetId as string);
  }
}

async function createMatrixSpreadsheet(
  client: LiveApiClient,
  manager: TestSpreadsheetManager,
  suffix: string
): Promise<MatrixSpreadsheet> {
  const title = `SERVAL_MATRIX_${suffix}_${Date.now()}`;
  const response = await client.executeWrite('matrix.createSpreadsheet', () =>
    client.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [
          { properties: { title: 'Sheet1', sheetId: 0 } },
          { properties: { title: 'TestData', sheetId: 1 } },
          { properties: { title: 'Benchmarks', sheetId: 2 } },
          { properties: { title: 'Formulas', sheetId: 3 } },
          { properties: { title: 'Lookup', sheetId: 4 } },
        ],
      },
    })
  );

  const spreadsheetId = response.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error('Matrix spreadsheet creation did not return a spreadsheetId');
  }

  manager.trackSpreadsheet(spreadsheetId);

  // Pre-flight: verify the spreadsheet is accessible before seeding and running
  // the action battery. A 404 here aborts early with a clear message instead of
  // letting 300+ action calls fail against a missing/inaccessible spreadsheet (Fix 4).
  const verifyResponse = await client.sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'spreadsheetId',
  });
  if (!verifyResponse.data.spreadsheetId) {
    throw new Error(
      `Pre-flight failed: spreadsheet ${spreadsheetId} (${title}) was created but is not accessible. ` +
        `Check credentials and Drive permissions.`
    );
  }

  await seedMatrixSpreadsheet(client, spreadsheetId);

  const sheet1 =
    response.data.sheets?.find((sheet) => sheet.properties?.title === 'Sheet1')?.properties?.sheetId ??
    0;

  return {
    id: spreadsheetId,
    title,
    sheetId: sheet1,
  };
}

async function seedMatrixSpreadsheet(
  client: LiveApiClient,
  spreadsheetId: string
): Promise<void> {
  const baseValues = [
    ['Name', 'Revenue', 'Cost', 'Date', 'Status', 'Profit'],
    ['Alice', 12500, 7800, '2024-01-01', 'Active', '=B2-C2'],
    ['Bob', 13200, 8100, '2024-01-02', 'Pending', '=B3-C3'],
    ['Charlie', 11800, 7200, '2024-01-03', 'Complete', '=B4-C4'],
    ['Dave', 14500, 8900, '2024-01-04', 'Draft', '=B5-C5'],
    ['Eve', 15200, 9300, '2024-01-05', 'Archived', '=B6-C6'],
  ];
  const benchmarkValues = [
    ['Metric', 'Value'],
    ['Rows', 5],
    ['Columns', 6],
    ['Checks', '=B2+B3'],
  ];
  const formulaValues = [
    ['Input', 'Rate', 'Output'],
    [10, 1.1, '=A2*B2'],
    [15, 1.2, '=A3*B3'],
    [20, 1.3, '=A4*B4'],
  ];
  const lookupValues = [
    ['Status', 'FollowUp1', 'FollowUp2'],
    ['Active', 'Call', 'Email'],
    ['Pending', 'Review', 'Escalate'],
    ['Complete', 'Archive', 'Report'],
    ['Draft', 'Revise', 'Publish'],
    ['Archived', 'Restore', 'Delete'],
  ];

  await client.executeWrite('matrix.seedSpreadsheet', () =>
    client.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: 'Sheet1!A1:F6', values: baseValues },
          { range: 'TestData!A1:F6', values: baseValues },
          { range: 'Benchmarks!A1:B4', values: benchmarkValues },
          { range: 'Formulas!A1:C4', values: formulaValues },
          { range: 'Lookup!A1:C6', values: lookupValues },
          { range: 'Sheet1!H1:H3', values: [['Trend'], ['=SPARKLINE(B2:B6)'], ['']] },
        ],
      },
    })
  );

  await client.executeWrite('matrix.seedNamedRange', () =>
    client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addNamedRange: {
              namedRange: {
                name: 'TestRange',
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 10,
                  startColumnIndex: 0,
                  endColumnIndex: 2,
                },
              },
            },
          },
          {
            addConditionalFormatRule: {
              index: 0,
              rule: {
                ranges: [
                  {
                    sheetId: 0,
                    startRowIndex: 1,
                    endRowIndex: 6,
                    startColumnIndex: 1,
                    endColumnIndex: 2,
                  },
                ],
                booleanRule: {
                  condition: {
                    type: 'NUMBER_GREATER',
                    values: [{ userEnteredValue: '12000' }],
                  },
                  format: {
                    backgroundColor: { red: 0.9, green: 1, blue: 0.9 },
                  },
                },
              },
            },
          },
          {
            setDataValidation: {
              range: {
                sheetId: 0,
                startRowIndex: 1,
                endRowIndex: 6,
                startColumnIndex: 4,
                endColumnIndex: 5,
              },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: [
                    { userEnteredValue: 'Active' },
                    { userEnteredValue: 'Pending' },
                    { userEnteredValue: 'Complete' },
                    { userEnteredValue: 'Draft' },
                    { userEnteredValue: 'Archived' },
                  ],
                },
                strict: true,
                showCustomUi: true,
              },
            },
          },
        ],
      },
    })
  );
}

async function runProbe(
  client: LiveApiClient,
  capability: ActionCapability,
  request: Record<string, unknown>,
  context: MatrixExecutionContext
): Promise<{ status: number }> {
  switch (capability.probeStrategy) {
    case 'auth_connectivity':
      return client.executeRead('matrix.probe.auth', async () =>
        client.sheets.spreadsheets.get({
          spreadsheetId: context.primary.id,
          fields: 'spreadsheetId',
        })
      );

    case 'multi_spreadsheet_metadata': {
      const spreadsheetIds = [...collectSpreadsheetIds(request)];
      if (spreadsheetIds.length === 0) {
        throw new Error('Probe expected spreadsheet IDs but none were materialized');
      }

      let lastStatus = 200;
      for (const spreadsheetId of spreadsheetIds) {
        const response = await client.executeRead('matrix.probe.multiSpreadsheet', async () =>
          client.sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'spreadsheetId',
          })
        );
        lastStatus = response.status;
      }

      return { status: lastStatus };
    }

    case 'range_readability': {
      const spreadsheetId = getFirstSpreadsheetId(request) ?? context.primary.id;
      const ranges = getProbeRanges(request);

      if (ranges.length > 1) {
        const response = await client.executeRead('matrix.probe.batchRange', async () =>
          client.sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges,
          })
        );
        return { status: response.status };
      }

      const range = ranges[0] ?? 'Sheet1!A1:F6';
      const response = await client.executeRead('matrix.probe.range', async () =>
        client.sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        })
      );
      return { status: response.status };
    }

    case 'sheet_metadata': {
      const spreadsheetId = getFirstSpreadsheetId(request) ?? context.primary.id;
      const response = await client.executeRead('matrix.probe.sheetMetadata', async () =>
        client.sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'spreadsheetId,sheets.properties(sheetId,title)',
        })
      );
      return { status: response.status };
    }

    case 'spreadsheet_metadata':
    default: {
      const spreadsheetId = getFirstSpreadsheetId(request) ?? context.primary.id;
      const response = await client.executeRead('matrix.probe.spreadsheetMetadata', async () =>
        client.sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'spreadsheetId,properties(title)',
        })
      );
      return { status: response.status };
    }
  }
}

function collectSpreadsheetIds(
  value: unknown,
  parentKey?: string,
  found: Set<string> = new Set()
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSpreadsheetIds(item, parentKey, found);
    }
    return found;
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (
        parentKey === 'spreadsheetId' ||
        parentKey === 'sourceSpreadsheetId' ||
        parentKey === 'destinationSpreadsheetId'
      ) {
        found.add(value);
      }
      if (parentKey === 'spreadsheetIds') {
        found.add(value);
      }
    }
    return found;
  }

  for (const [key, child] of Object.entries(value)) {
    collectSpreadsheetIds(child, key, found);
  }

  return found;
}

function getFirstSpreadsheetId(request: Record<string, unknown>): string | undefined {
  return [...collectSpreadsheetIds(request)][0];
}

function getProbeRanges(request: Record<string, unknown>): string[] {
  const ranges: string[] = [];
  const rangeKeys = [
    'range',
    'sourceRange',
    'dataRange',
    'parentRange',
    'dependentRange',
    'destinationRange',
    'fillRange',
  ];

  for (const key of rangeKeys) {
    const value = request[key];
    if (typeof value === 'string') {
      ranges.push(value);
    }
  }

  const explicitRanges = request['ranges'];
  if (Array.isArray(explicitRanges)) {
    for (const value of explicitRanges) {
      if (typeof value === 'string') {
        ranges.push(value);
      }
    }
  }

  return [...new Set(ranges)].slice(0, 3);
}

function parseMcpOutcome(result: CallToolResult): ParsedMcpOutcome {
  const payload = extractToolPayload(result);
  const response =
    payload && typeof payload === 'object' && !Array.isArray(payload) && 'response' in payload
      ? (payload['response'] as Record<string, unknown> | undefined)
      : (payload as Record<string, unknown> | undefined);

  const error = response?.['error'] as
    | {
        code?: string;
        message?: string;
        retryable?: boolean;
        retryAfterMs?: number;
        category?: string;
      }
    | undefined;

  if (typeof response?.['success'] === 'boolean') {
    return {
      success: response['success'] as boolean,
      errorCode: error?.code,
      errorMessage: error?.message,
      mcpError: error,
    };
  }

  return {
    success: result.isError !== true,
    errorCode: error?.code,
    errorMessage: error?.message,
    mcpError: error,
  };
}

function extractToolPayload(result: CallToolResult): Record<string, unknown> | null {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }

  const textBlock = result.content.find(
    (block) => block.type === 'text' && typeof block.text === 'string'
  );

  if (!textBlock?.text) {
    return null;
  }

  try {
    return JSON.parse(textBlock.text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeTransportError(error: unknown): { message: string; status?: number } {
  const candidate = error as { message?: string; status?: number; code?: string | number };
  const fallback = candidate.code ? String(candidate.code) : 'Unknown transport error';

  return {
    message: candidate.message ?? fallback,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
  };
}

function isRetryableRateLimitMcpOutcome(parsed: ParsedMcpOutcome): boolean {
  const code = parsed.mcpError?.code ?? parsed.errorCode;
  const message = parsed.mcpError?.message ?? parsed.errorMessage ?? '';
  const category = parsed.mcpError?.category;

  return (
    parsed.success === false &&
    (code === 'RATE_LIMITED' ||
      category === 'quota' ||
      /rate limit|quota exceeded|retry after/i.test(message))
  );
}

function isRetryableTimeoutMcpOutcome(parsed: ParsedMcpOutcome): boolean {
  const code = parsed.mcpError?.code ?? parsed.errorCode;
  const message = parsed.mcpError?.message ?? parsed.errorMessage ?? '';

  return (
    parsed.success === false &&
    (code === 'DEADLINE_EXCEEDED' || /timed out|deadline exceeded|request timeout/i.test(message))
  );
}

function isTransportTimeoutError(error: { message: string; status?: number }): boolean {
  return error.status === 408 || /timed out|deadline exceeded|request timeout/i.test(error.message);
}

process.on('exit', () => {
  if (registeredTempServiceAccountPath) {
    fs.rmSync(registeredTempServiceAccountPath, { force: true });
  }
});
