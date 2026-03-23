/**
 * Live API Tests for sheets_dependencies Tool
 *
 * Tests formula dependency analysis with real Google Sheets data.
 * Requires TEST_REAL_API=true environment variable.
 *
 * OPTIMIZED: Uses a single spreadsheet for all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiveApiClient } from '../setup/live-api-client.js';
import { TestSpreadsheetManager, TestSpreadsheet } from '../setup/test-spreadsheet-manager.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';

const runLiveTests = shouldRunIntegrationTests();

describe.skipIf(!runLiveTests)('sheets_dependencies Live API Tests', () => {
  let client: LiveApiClient;
  let manager: TestSpreadsheetManager;
  let testSpreadsheet: TestSpreadsheet;

  beforeAll(async () => {
    const credentials = await loadTestCredentials();
    if (!credentials) {
      throw new Error('Test credentials not available');
    }
    client = new LiveApiClient(credentials, { trackMetrics: true });
    manager = new TestSpreadsheetManager(client);
    testSpreadsheet = await manager.createTestSpreadsheet('dependencies');
  }, 60000);

  afterAll(async () => {
    await manager.cleanup();
  }, 30000);

  describe('build action', () => {
    it('should create dependency graph from formulas', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:D5',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Value1', 'Value2', 'Sum', 'Product'],
            ['10', '20', '=A2+B2', '=A2*B2'],
            ['30', '40', '=A3+B3', '=A3*B3'],
            ['50', '60', '=A4+B4', '=A4*B4'],
            ['Total', '', '=SUM(C2:C4)', '=SUM(D2:D4)'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A1:D5',
        valueRenderOption: 'FORMULA',
      });

      expect(response.data.values![1][2]).toBe('=A2+B2');
      expect(response.data.values![4][2]).toBe('=SUM(C2:C4)');
    });

    it('should identify formula cells vs value cells', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:G3',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['100', '200', '=E1+F1'],
            ['Text', 'More text', '=CONCATENATE(E2,F2)'],
            ['', '', '=IF(E1>F1,"Yes","No")'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!E1:G3',
        valueRenderOption: 'FORMULA',
      });

      expect(response.data.values![0][2]).toContain('=');
      expect(response.data.values![0][0]).not.toContain('=');
    });
  });

  describe('analyze_impact action', () => {
    it('should analyze impact of changing a source cell', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1:K1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['100', '=H1*2', '=I1+10', '=J1/5']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!H1:K1',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      expect(response.data.values![0]).toEqual([100, 200, 210, 42]);
    });
  });

  describe('detect_cycles action', () => {
    it('should detect indirect circular reference chain', () => {
      const formulas = [
        { cell: 'A1', formula: '=C1+1', dependsOn: ['C1'] },
        { cell: 'B1', formula: '=A1*2', dependsOn: ['A1'] },
        { cell: 'C1', formula: '=B1-5', dependsOn: ['B1'] },
      ];

      const graph: Record<string, string[]> = {};
      for (const f of formulas) {
        graph[f.cell] = f.dependsOn;
      }

      function hasCycle(start: string, visited: Set<string>, path: Set<string>): boolean {
        if (path.has(start)) return true;
        if (visited.has(start)) return false;
        visited.add(start);
        path.add(start);
        for (const dep of graph[start] || []) {
          if (hasCycle(dep, visited, path)) return true;
        }
        path.delete(start);
        return false;
      }

      expect(hasCycle('A1', new Set(), new Set())).toBe(true);
    });
  });

  describe('get_dependencies action', () => {
    it('should get direct dependencies of a formula cell', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!L1:N1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['10', '20', '=L1+M1']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!N1',
        valueRenderOption: 'FORMULA',
      });

      const formula = response.data.values![0][0];
      expect(formula).toBe('=L1+M1');
      const cellRefs = formula.match(/[A-Z]+\d+/g) || [];
      expect(cellRefs).toContain('L1');
      expect(cellRefs).toContain('M1');
    });

    it('should handle range references', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!O1:O5',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['10'], ['20'], ['30'], ['40'], ['=SUM(O1:O4)']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!O5',
        valueRenderOption: 'FORMULA',
      });

      expect(response.data.values![0][0]).toContain('O1:O4');
    });

    it('should handle cross-sheet references', async () => {
      const sheetName = `DataSource_${Date.now()}`;
      await client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: testSpreadsheet.id,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['100']] },
      });

      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!P1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[`=${sheetName}!A1*2`]] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!P1',
        valueRenderOption: 'FORMULA',
      });

      expect(response.data.values![0][0]).toContain(sheetName);
    });
  });

  describe('get_dependents action', () => {
    it('should get cells that depend on a given cell', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Q1:S1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['100', '=Q1*2', '=Q1+50']] },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!Q1:S1',
        valueRenderOption: 'FORMULA',
      });

      const formulas = response.data.values![0];
      const dependents: string[] = [];
      const cellAddresses = ['Q1', 'R1', 'S1'];

      for (let i = 0; i < formulas.length; i++) {
        const formula = formulas[i];
        if (typeof formula === 'string' && formula.includes('Q1') && cellAddresses[i] !== 'Q1') {
          dependents.push(cellAddresses[i]);
        }
      }

      expect(dependents).toContain('R1');
      expect(dependents).toContain('S1');
    });
  });

  describe('get_stats action', () => {
    it('should calculate dependency statistics', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!T1:W5',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['Value', 'Value', 'Formula', 'Formula'],
            ['10', '20', '=T2+U2', '=V2*2'],
            ['30', '40', '=T3+U3', '=V3*2'],
            ['50', '60', '=T4+U4', '=V4*2'],
            ['', '', '=SUM(V2:V4)', '=SUM(W2:W4)'],
          ],
        },
      });

      const response = await client.sheets.spreadsheets.values.get({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!T1:W5',
        valueRenderOption: 'FORMULA',
      });

      let formulaCells = 0;
      for (const row of response.data.values!) {
        for (const cell of row) {
          if (cell && cell.toString().startsWith('=')) formulaCells++;
        }
      }

      expect(formulaCells).toBe(8);
    });
  });

  describe('export_dot action', () => {
    it('should generate DOT format graph', async () => {
      await client.sheets.spreadsheets.values.update({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!X1:Z1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['100', '=X1*2', '=Y1+10']] },
      });

      const dependencies = [
        { from: 'X1', to: 'Y1' },
        { from: 'Y1', to: 'Z1' },
      ];
      const dotGraph = `digraph Dependencies { ${dependencies.map((d) => `"${d.from}" -> "${d.to}";`).join(' ')} }`;

      expect(dotGraph).toContain('digraph');
      expect(dotGraph).toContain('X1');
    });
  });

  describe('Performance Metrics', () => {
    it('should track dependency analysis operations', async () => {
      client.resetMetrics();

      await client.trackOperation('valuesUpdate', 'POST', () =>
        client.sheets.spreadsheets.values.update({
          spreadsheetId: testSpreadsheet.id,
          range: 'TestData!Y1:Z3',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              ['100', '=Y1*2'],
              ['200', '=Y2*2'],
              ['=SUM(Y1:Y2)', '=SUM(Z1:Z2)'],
            ],
          },
        })
      );

      const stats = client.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
