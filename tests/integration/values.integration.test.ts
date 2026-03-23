/**
 * ServalSheets v4 - Values Handler Integration Tests
 *
 * Integration tests that run against the real Google Sheets API.
 * Requires test credentials to be configured.
 *
 * Run with: TEST_REAL_API=true npm test
 * See tests/INTEGRATION_TEST_SETUP.md for setup instructions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  shouldRunIntegrationTests,
  checkCredentialsOrSkip,
  type TestCredentials,
} from '../helpers/credential-loader.js';
import { createServalSheetsTestHarness, type McpTestHarness } from '../helpers/mcp-test-harness.js';

// Skip if not running integration tests
const SKIP_INTEGRATION = !shouldRunIntegrationTests();

const permissionTest = process.env['TEST_FORBIDDEN_SPREADSHEET_ID'] ? it : it.skip;

describe.skipIf(SKIP_INTEGRATION)('Values Handler Integration', () => {
  let credentials: TestCredentials;
  let harness: McpTestHarness | undefined;
  let testSpreadsheetId: string;
  let testSheetTitle: string;
  let testSheetId: number | undefined;
  let tempDir: string | undefined;

  const testValues = [
    ['Name', 'Value', 'Date', 'Status'],
    ['Test 1', 100, '2024-01-01', 'Active'],
    ['Test 2', 200, '2024-01-02', 'Pending'],
    ['Test 3', 300, '2024-01-03', 'Complete'],
  ];

  const range = (a1: string): string => `${testSheetTitle}!${a1}`;

  const callTool = async <T>(name: string, request: Record<string, unknown>): Promise<T> => {
    const result = await harness.client.callTool({
      name,
      arguments: { request },
    });
    return result.structuredContent as T;
  };

  const callValues = (request: Record<string, unknown>) =>
    callTool<{ response: Record<string, unknown> }>('sheets_data', request);

  const callSheets = (request: Record<string, unknown>) =>
    callTool<{ response: Record<string, unknown> }>('sheets_core', request);

  const callVersions = (request: Record<string, unknown>) =>
    callTool<{ response: Record<string, unknown> }>('sheets_collaborate', request);

  const expectSuccess = <T extends Record<string, unknown>>(payload: { response: T }): T => {
    expect(payload.response['success']).toBe(true);
    return payload.response;
  };

  beforeAll(async () => {
    credentials = await checkCredentialsOrSkip();
    testSpreadsheetId = credentials.testSpreadsheet.id;
    testSheetTitle = `IntegrationTest_${Date.now()}`;

    if (credentials.serviceAccount) {
      tempDir = await mkdtemp(join(process.cwd(), 'tests/.tmp-'));
      const keyPath = join(tempDir, 'service-account.json');
      await writeFile(keyPath, JSON.stringify(credentials.serviceAccount, null, 2));

      harness = await createServalSheetsTestHarness({
        serverOptions: {
          name: 'servalsheets-test',
          version: '1.0.0-test',
          googleApiOptions: {
            serviceAccountKeyPath: keyPath,
          },
        },
      });
    } else if (credentials.oauth) {
      harness = await createServalSheetsTestHarness({
        serverOptions: {
          name: 'servalsheets-test',
          version: '1.0.0-test',
          googleApiOptions: {
            credentials: {
              clientId: credentials.oauth.client_id,
              clientSecret: credentials.oauth.client_secret,
              redirectUri: credentials.oauth.redirect_uri,
            },
            accessToken: credentials.oauth.tokens.access_token,
            refreshToken: credentials.oauth.tokens.refresh_token,
            scopes: credentials.oauth.tokens.scope.split(' ').filter(Boolean),
          },
        },
      });
    } else {
      throw new Error('No usable credentials found for integration harness setup');
    }

    const addSheet = await callSheets({
      action: 'add_sheet',
      spreadsheetId: testSpreadsheetId,
      title: testSheetTitle,
      rowCount: 200,
      columnCount: 20,
    });

    const addResponse = expectSuccess(addSheet);
    testSheetId = (addResponse['sheet'] as { sheetId?: number })?.sheetId;
  });

  afterAll(async () => {
    if (testSheetId !== undefined) {
      await callSheets({
        action: 'delete_sheet',
        spreadsheetId: testSpreadsheetId,
        sheetId: testSheetId,
        allowMissing: true,
      });
    }

    if (harness) {
      await harness.close();
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('Read Operations', () => {
    it('should read values from a range', async () => {
      const writeResult = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A1:D4'),
        values: testValues,
        valueInputOption: 'USER_ENTERED',
      });
      expectSuccess(writeResult);

      const response = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A1:D4'),
      });

      const payload = expectSuccess(response);
      expect(payload['values']).toBeDefined();
      expect((payload['values'] as unknown[][])[0]).toEqual(testValues[0]);
    });

    it('should read with different value render options', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A6:B7'),
        values: [
          ['Label', 'Amount'],
          ['Row', 123],
        ],
        valueInputOption: 'USER_ENTERED',
      });

      const response = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A6:B7'),
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const payload = expectSuccess(response);
      expect((payload['values'] as unknown[][])[1]?.[1]).toBe(123);
    });

    it('should handle reading empty range', async () => {
      const response = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A190:D190'),
      });

      const payload = expectSuccess(response);
      expect(payload['values'] ?? []).toHaveLength(0);
    });
  });

  describe('Write Operations', () => {
    it('should write values to a range', async () => {
      const response = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A10:B12'),
        values: [
          ['Item', 'Qty'],
          ['Apple', 2],
          ['Banana', 5],
        ],
      });

      const payload = expectSuccess(response);
      expect(payload['updatedCells']).toBeGreaterThan(0);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A10:B12'),
      });
      const readPayload = expectSuccess(readBack);
      expect((readPayload['values'] as unknown[][])[1]).toEqual(['Apple', 2]);
    });

    it('should respect valueInputOption RAW', async () => {
      const response = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('C10:C10'),
        values: [['=1+1']],
        valueInputOption: 'RAW',
      });
      expectSuccess(response);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('C10:C10'),
        valueRenderOption: 'FORMATTED_VALUE',
      });

      const payload = expectSuccess(readBack);
      expect((payload['values'] as unknown[][])[0]?.[0]).toBe('=1+1');
    });

    it('should respect valueInputOption USER_ENTERED', async () => {
      const response = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('D10:D10'),
        values: [['=1+1']],
        valueInputOption: 'USER_ENTERED',
      });
      expectSuccess(response);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('D10:D10'),
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const payload = expectSuccess(readBack);
      expect((payload['values'] as unknown[][])[0]?.[0]).toBe(2);
    });

    it('should support dry-run mode', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A15:B15'),
        values: [['Dry', 'Run']],
      });

      const before = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A15:B15'),
      });
      const beforePayload = expectSuccess(before);

      const dryRun = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A15:B15'),
        values: [['Changed', 'Value']],
        safety: { dryRun: true },
      });
      expectSuccess(dryRun);

      const after = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A15:B15'),
      });
      const afterPayload = expectSuccess(after);

      expect(afterPayload['values']).toEqual(beforePayload['values']);
    });
  });

  describe('Append Operations', () => {
    it('should append rows to the end of data', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A20:B21'),
        values: [
          ['Item', 'Qty'],
          ['Orange', 1],
        ],
      });

      const response = await callValues({
        action: 'append',
        spreadsheetId: testSpreadsheetId,
        range: range('A20:B20'),
        values: [['Grape', 4]],
      });
      expectSuccess(response);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A20:B22'),
      });
      const payload = expectSuccess(readBack);
      expect((payload['values'] as unknown[][])[2]).toEqual(['Grape', 4]);
    });

    it('should handle append to empty sheet', async () => {
      await callValues({
        action: 'clear',
        spreadsheetId: testSpreadsheetId,
        range: range('A30:B31'),
        safety: { autoSnapshot: false },
      });

      const response = await callValues({
        action: 'append',
        spreadsheetId: testSpreadsheetId,
        range: range('A30:B30'),
        values: [['First', 1]],
      });
      expectSuccess(response);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A30:B30'),
      });
      const payload = expectSuccess(readBack);
      expect((payload['values'] as unknown[][])[0]).toEqual(['First', 1]);
    });
  });

  describe('Clear Operations', () => {
    it('should clear values in a range', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A40:C41'),
        values: [
          ['A', 'B', 'C'],
          ['1', '2', '3'],
        ],
      });

      const response = await callValues({
        action: 'clear',
        spreadsheetId: testSpreadsheetId,
        range: range('A40:C41'),
        safety: { autoSnapshot: false },
      });
      expectSuccess(response);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A40:C41'),
      });
      const payload = expectSuccess(readBack);
      expect(payload['values'] ?? []).toHaveLength(0);
    });

    it('should respect effect scope limits', async () => {
      const response = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A90:B91'),
        values: [
          ['1', '2'],
          ['3', '4'],
        ],
        safety: { effectScope: { maxCellsAffected: 1 } },
      });

      expect(response.response['success']).toBe(false);
      expect((response.response as { error?: { code?: string } }).error?.code).toBe(
        'EFFECT_SCOPE_EXCEEDED'
      );
    });
  });

  describe('Find and Replace', () => {
    it('should find values matching a pattern', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A50:C52'),
        values: [
          ['apple', 'banana', 'carrot'],
          ['apple pie', 'banana bread', 'carrot cake'],
          ['apples', 'bananas', 'carrots'],
        ],
      });

      const response = await callValues({
        action: 'find_replace',
        spreadsheetId: testSpreadsheetId,
        range: range('A50:C52'),
        find: 'apple',
      });

      const payload = expectSuccess(response);
      expect((payload['matches'] as unknown[])?.length).toBeGreaterThan(0);
    });

    it('should replace values matching a pattern', async () => {
      const response = await callValues({
        action: 'find_replace',
        spreadsheetId: testSpreadsheetId,
        range: range('A50:C52'),
        find: 'banana',
        replacement: 'pear',
      });

      const payload = expectSuccess(response);
      expect(payload['replacementsCount']).toBeDefined();

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A50:C52'),
      });
      const readPayload = expectSuccess(readBack);
      const values = readPayload['values'] as unknown[][];
      expect(values.flat().join(' ')).not.toContain('banana');
    });

    it('should support matchEntireCell for exact matches', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A55:B55'),
        values: [['foo', 'foobar']],
      });

      const response = await callValues({
        action: 'find_replace',
        spreadsheetId: testSpreadsheetId,
        range: range('A55:B55'),
        find: 'foo',
        matchEntireCell: true,
      });

      const payload = expectSuccess(response);
      expect((payload['matches'] as Array<{ value: string }>).map((m) => m.value)).toEqual(['foo']);
    });
  });

  describe('Batch Operations', () => {
    it('should batch read multiple ranges', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A60:A61'),
        values: [['Left'], ['Right']],
      });
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('B60:B61'),
        values: [['Up'], ['Down']],
      });

      const response = await callValues({
        action: 'batch_read',
        spreadsheetId: testSpreadsheetId,
        ranges: [range('A60:A61'), range('B60:B61')],
      });

      const payload = expectSuccess(response);
      expect((payload['valueRanges'] as unknown[])?.length).toBe(2);
    });

    it('should batch write to multiple ranges', async () => {
      const response = await callValues({
        action: 'batch_write',
        spreadsheetId: testSpreadsheetId,
        data: [
          { range: range('A70:A71'), values: [['Batch1'], ['Batch2']] },
          { range: range('B70:B71'), values: [['Batch3'], ['Batch4']] },
        ],
      });

      const payload = expectSuccess(response);
      expect(payload['updatedCells']).toBeDefined();

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A70:B71'),
      });
      const readPayload = expectSuccess(readBack);
      expect((readPayload['values'] as unknown[][])[0]).toEqual(['Batch1', 'Batch3']);
    });

    it('should batch clear multiple ranges', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A80:A81'),
        values: [['X'], ['Y']],
      });
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('B80:B81'),
        values: [['Z'], ['W']],
      });

      const response = await callValues({
        action: 'batch_clear',
        spreadsheetId: testSpreadsheetId,
        ranges: [range('A80:A81'), range('B80:B81')],
        safety: { autoSnapshot: false },
      });
      expectSuccess(response);

      const readBack = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: range('A80:B81'),
      });
      const payload = expectSuccess(readBack);
      expect(payload['values'] ?? []).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should return proper error for non-existent spreadsheet', async () => {
      const response = await callValues({
        action: 'read',
        spreadsheetId: 'not-a-real-spreadsheet',
        range: range('A1:B2'),
      });

      expect(response.response['success']).toBe(false);
      expect((response.response as { error?: unknown }).error).toBeDefined();
    });

    it('should return proper error for invalid range', async () => {
      const response = await callValues({
        action: 'read',
        spreadsheetId: testSpreadsheetId,
        range: 'InvalidRange',
      });

      expect(response.response['success']).toBe(false);
      expect((response.response as { error?: unknown }).error).toBeDefined();
    });

    permissionTest('should return proper error for permission denied', async () => {
      const forbiddenId = process.env['TEST_FORBIDDEN_SPREADSHEET_ID'] as string;
      const response = await callValues({
        action: 'read',
        spreadsheetId: forbiddenId,
        range: 'A1:B2',
      });

      expect(response.response['success']).toBe(false);
      expect((response.response as { error?: { code?: string } }).error?.code).toMatch(
        /PERMISSION_DENIED|NOT_FOUND/
      );
    });
  });

  describe('Safety Rails', () => {
    it('should enforce expected state before write', async () => {
      const response = await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A100:A101'),
        values: [['Safe'], ['Write']],
        safety: {
          expectedState: { sheetTitle: 'non-existent-sheet' },
        },
      });

      expect(response.response['success']).toBe(false);
      expect((response.response as { error?: { code?: string } }).error?.code).toBe(
        'PRECONDITION_FAILED'
      );
    });

    it('should create auto-snapshot for destructive operations', async () => {
      await callValues({
        action: 'write',
        spreadsheetId: testSpreadsheetId,
        range: range('A110:B111'),
        values: [
          ['Snapshot', 'Test'],
          ['Before', 'Clear'],
        ],
      });

      const response = await callValues({
        action: 'clear',
        spreadsheetId: testSpreadsheetId,
        range: range('A110:B111'),
        safety: { autoSnapshot: true },
      });

      const payload = expectSuccess(response);
      const snapshotId = (payload['mutation'] as { revertSnapshotId?: string } | undefined)
        ?.revertSnapshotId;
      expect(snapshotId).toBeDefined();

      if (snapshotId) {
        await callVersions({
          action: 'version_delete_snapshot',
          spreadsheetId: testSpreadsheetId,
          snapshotId,
        });
      }
    });
  });
});
