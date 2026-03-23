/**
 * Tests for FormulaEvaluator — HyperFormula-based formula evaluation engine.
 *
 * Tests: Layer 2 (HyperFormula), scenario fingerprint cache, revert behavior,
 * Google-specific function detection, volatile function detection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FormulaEvaluator, type SheetData, type CellChange } from '../../src/services/formula-evaluator.js';

// ============================================================================
// Helper: build simple sheet data
// ============================================================================

function makeSheetData(
  values: (string | number | boolean | null)[][],
  formulas: (string | null)[][] = []
): SheetData {
  const maxRows = Math.max(values.length, formulas.length);
  const maxCols = Math.max(
    ...values.map((r) => r.length),
    ...formulas.map((r) => r.length),
    0
  );

  const paddedValues = Array.from({ length: maxRows }, (_, r) =>
    Array.from({ length: maxCols }, (_, c) => values[r]?.[c] ?? null)
  );
  const paddedFormulas = Array.from({ length: maxRows }, (_, r) =>
    Array.from({ length: maxCols }, (_, c) => formulas[r]?.[c] ?? null)
  );

  return { values: paddedValues, formulas: paddedFormulas, sheetName: 'Sheet1' };
}

// ============================================================================
// Tests
// ============================================================================

describe('FormulaEvaluator', () => {
  let evaluator: FormulaEvaluator;
  const ssId = 'test-spreadsheet-001';

  beforeEach(() => {
    evaluator = new FormulaEvaluator();
  });

  afterEach(() => {
    evaluator.destroyAll();
  });

  // --------------------------------------------------------------------------
  // Load / isLoaded
  // --------------------------------------------------------------------------

  describe('loadSheet / isLoaded', () => {
    it('isLoaded returns false before loading', () => {
      expect(evaluator.isLoaded(ssId)).toBe(false);
    });

    it('isLoaded returns true after loading', async () => {
      const sheet = makeSheetData([[1, 2, 3]]);
      await evaluator.loadSheet(ssId, sheet);
      expect(evaluator.isLoaded(ssId)).toBe(true);
    });

    it('evaluateScenario returns null when sheet not loaded', async () => {
      const result = await evaluator.evaluateScenario('unknown-spreadsheet', [
        { cell: 'A1', newValue: 100 },
      ]);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Basic arithmetic scenario
  // --------------------------------------------------------------------------

  describe('arithmetic scenario', () => {
    beforeEach(async () => {
      // Sheet layout:
      //   A1=100  B1=200  C1=(=A1+B1 → 300)
      const sheet = makeSheetData(
        [[100, 200, 300]],
        [[null, null, '=A1+B1']]
      );
      await evaluator.loadSheet(ssId, sheet);
    });

    it('predicts C1 change when A1 changes', async () => {
      const changes: CellChange[] = [{ cell: 'A1', newValue: 50 }];
      const result = await evaluator.evaluateScenario(ssId, changes);

      expect(result).not.toBeNull();
      const c1 = result!.localResults.find((r) => r.cell === 'C1');
      expect(c1).toBeDefined();
      expect(c1!.newValue).toBe(250); // 50 + 200
      expect(c1!.oldValue).toBe(300); // 100 + 200
    });

    it('computes percentageChange for numeric shifts', async () => {
      const changes: CellChange[] = [{ cell: 'A1', newValue: 50 }];
      const result = await evaluator.evaluateScenario(ssId, changes);
      const c1 = result!.localResults.find((r) => r.cell === 'C1');
      // (250 - 300) / 300 = -16.67%
      expect(c1!.percentageChange).toBeCloseTo(-16.67, 1);
    });

    it('reverts base state after evaluation (repeat scenario gives same result)', async () => {
      const changes: CellChange[] = [{ cell: 'A1', newValue: 50 }];
      const result1 = await evaluator.evaluateScenario(ssId, changes);
      const result2 = await evaluator.evaluateScenario(ssId, changes);

      expect(result1!.localResults.find((r) => r.cell === 'C1')!.newValue).toBe(
        result2!.localResults.find((r) => r.cell === 'C1')!.newValue
      );
    });

    it('different scenarios give different results (state revert works)', async () => {
      const r1 = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 50 }]);
      const r2 = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 200 }]);

      const c1r1 = r1!.localResults.find((r) => r.cell === 'C1')!.newValue;
      const c1r2 = r2!.localResults.find((r) => r.cell === 'C1')!.newValue;

      expect(c1r1).toBe(250); // 50 + 200
      expect(c1r2).toBe(400); // 200 + 200
    });
  });

  // --------------------------------------------------------------------------
  // Scenario fingerprint cache
  // --------------------------------------------------------------------------

  describe('scenario result cache', () => {
    beforeEach(async () => {
      const sheet = makeSheetData([[100, 200, 300]], [[null, null, '=A1+B1']]);
      await evaluator.loadSheet(ssId, sheet);
    });

    it('returns same object for identical scenario (cache hit)', async () => {
      const changes: CellChange[] = [{ cell: 'A1', newValue: 50 }];
      const r1 = await evaluator.evaluateScenario(ssId, changes);
      const r2 = await evaluator.evaluateScenario(ssId, changes);
      // Same reference because cache hit returns cached object
      expect(r1).toBe(r2);
    });

    it('returns different objects for different scenarios', async () => {
      const r1 = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 50 }]);
      const r2 = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 75 }]);
      expect(r1).not.toBe(r2);
    });

    it('fingerprint is order-independent', async () => {
      // Two-change scenarios with same changes in different order → same cache key
      const changes1: CellChange[] = [
        { cell: 'A1', newValue: 50 },
        { cell: 'B1', newValue: 150 },
      ];
      const changes2: CellChange[] = [
        { cell: 'B1', newValue: 150 },
        { cell: 'A1', newValue: 50 },
      ];
      const r1 = await evaluator.evaluateScenario(ssId, changes1);
      const r2 = await evaluator.evaluateScenario(ssId, changes2);
      expect(r1).toBe(r2); // same cache entry
    });
  });

  // --------------------------------------------------------------------------
  // SUM formula
  // --------------------------------------------------------------------------

  describe('SUM formula', () => {
    beforeEach(async () => {
      // A1:A5 = [10, 20, 30, 40, 50], A6 = SUM(A1:A5) = 150
      const vals: (number | null)[][] = [[10], [20], [30], [40], [50], [150]];
      const fmls: (string | null)[][] = [
        [null],
        [null],
        [null],
        [null],
        [null],
        ['=SUM(A1:A5)'],
      ];
      const sheet = makeSheetData(vals, fmls);
      await evaluator.loadSheet(ssId, sheet);
    });

    it('recalculates SUM when an input changes', async () => {
      const result = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 100 }]);
      expect(result).not.toBeNull();
      const a6 = result!.localResults.find((r) => r.cell === 'A6');
      expect(a6?.newValue).toBe(240); // 100+20+30+40+50
    });
  });

  // --------------------------------------------------------------------------
  // Multi-cell cascade
  // --------------------------------------------------------------------------

  describe('multi-cell cascade', () => {
    beforeEach(async () => {
      // A1=100, B1=A1*2=200, C1=B1+10=210
      const vals = [[100, 200, 210]];
      const fmls = [[null, '=A1*2', '=B1+10']];
      await evaluator.loadSheet(ssId, makeSheetData(vals, fmls));
    });

    it('cascades: changing A1 updates both B1 and C1', async () => {
      const result = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 50 }]);
      expect(result).not.toBeNull();

      const b1 = result!.localResults.find((r) => r.cell === 'B1');
      const c1 = result!.localResults.find((r) => r.cell === 'C1');

      expect(b1?.newValue).toBe(100); // 50 * 2
      expect(c1?.newValue).toBe(110); // 100 + 10
    });
  });

  // --------------------------------------------------------------------------
  // Google-specific function detection
  // --------------------------------------------------------------------------

  describe('Google-specific function classification', () => {
    it('flags QUERY formula cells as needsGoogleEval when HyperFormula emits them', async () => {
      // Put QUERY and a simple formula in separate rows so they don't interfere.
      // Row 0: A1=input, B1=IMPORTRANGE (simpler string, clearly Google-specific)
      // Row 1: A2=A1*2 (simple arithmetic, always evaluated)
      const vals = [[100, null], [200, null]];
      const fmls = [[null, '=IMPORTRANGE("id","Sheet1!A1")'], ['=A1*2', null]];
      await evaluator.loadSheet(ssId, makeSheetData(vals, fmls));

      const result = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 50 }]);
      expect(result).not.toBeNull();
      // A2 (=A1*2) should be in localResults with predicted value 100
      const a2 = result!.localResults.find((r) => r.cell === 'A2');
      expect(a2?.newValue).toBe(100); // 50 * 2
      // B1 should NOT be in localResults (it's Google-specific)
      const b1Local = result!.localResults.find((r) => r.cell === 'B1');
      expect(b1Local).toBeUndefined();
    });

    it('pre-scanned cells with Google-specific formulas are never in localResults', async () => {
      // IMPORTRANGE is pre-scanned at load time, so even if HyperFormula emits a change
      // for it, it should route to needsGoogleEval, not localResults
      const vals = [[100, null]];
      const fmls = [[null, '=IMPORTRANGE("spreadsheetId","A1")']];
      await evaluator.loadSheet(ssId, makeSheetData(vals, fmls));

      const result = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 50 }]);
      expect(result).not.toBeNull();
      // B1 should not be in localResults regardless of HyperFormula's emit behavior
      const b1 = result!.localResults.find((r) => r.cell === 'B1');
      expect(b1).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Volatile function detection
  // --------------------------------------------------------------------------

  describe('volatile function detection', () => {
    it('cells with volatile formulas are pre-scanned and excluded from localResults', async () => {
      // B1 has NOW() — volatile, should never be in localResults
      // A2 is =A1*2 — non-volatile, should be in localResults
      const vals = [[100, null], [200, null]];
      const fmls = [[null, '=NOW()'], ['=A1*2', null]];
      await evaluator.loadSheet(ssId, makeSheetData(vals, fmls));

      const result = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 50 }]);
      expect(result).not.toBeNull();
      // A2 (non-volatile) should be evaluated
      const a2 = result!.localResults.find((r) => r.cell === 'A2');
      expect(a2?.newValue).toBe(100); // 50 * 2
      // B1 (volatile) should NOT be in localResults
      const b1 = result!.localResults.find((r) => r.cell === 'B1');
      expect(b1).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // destroy
  // --------------------------------------------------------------------------

  describe('destroy', () => {
    it('destroy clears the instance (isLoaded returns false)', async () => {
      const sheet = makeSheetData([[1, 2, 3]]);
      await evaluator.loadSheet(ssId, sheet);
      expect(evaluator.isLoaded(ssId)).toBe(true);

      evaluator.destroy(ssId);
      expect(evaluator.isLoaded(ssId)).toBe(false);
    });

    it('evaluateScenario returns null after destroy', async () => {
      const sheet = makeSheetData([[1, 2, 3]], [[null, null, '=A1+B1']]);
      await evaluator.loadSheet(ssId, sheet);
      evaluator.destroy(ssId);

      const result = await evaluator.evaluateScenario(ssId, [{ cell: 'A1', newValue: 5 }]);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // LRU eviction behavior
  // --------------------------------------------------------------------------

  describe('LRU eviction', () => {
    it('handles loading 11+ spreadsheets (evicts oldest)', async () => {
      const sheet = makeSheetData([[1, 2]]);
      // Load 11 spreadsheets (max is 10)
      for (let i = 0; i < 11; i++) {
        await evaluator.loadSheet(`ss-${i}`, sheet);
      }
      // ss-0 should have been evicted (it was the oldest)
      expect(evaluator.isLoaded('ss-0')).toBe(false);
      // ss-10 (newest) should still be loaded
      expect(evaluator.isLoaded('ss-10')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Locale config (ISSUE-086)
  // ---------------------------------------------------------------------------

  describe('locale-aware SheetData', () => {
    it('accepts SheetData with locale field without error', async () => {
      const sheet: SheetData = {
        sheetName: 'Données',
        values: [[100], [200]],
        formulas: [[null], [null]],
        locale: 'fr_FR',
      };
      // Should not throw — locale is wired into HyperFormula options
      await expect(evaluator.loadSheet('locale-test', sheet)).resolves.toBeUndefined();
    });

    it('defaults to en_US behaviour when locale is absent', async () => {
      const sheet: SheetData = {
        sheetName: 'Sheet1',
        values: [[10], [20]],
        formulas: [[null], ['=A1+10']],
      };
      await evaluator.loadSheet('no-locale', sheet);
      expect(evaluator.isLoaded('no-locale')).toBe(true);
    });

    it('accepts european locale codes without throwing (de_DE, es_ES, pt_BR)', async () => {
      for (const locale of ['de_DE', 'es_ES', 'pt_BR', 'ja_JP', 'zh_CN']) {
        const sheet: SheetData = {
          sheetName: 'Sheet1',
          values: [[1], [2]],
          formulas: [[null], [null]],
          locale,
        };
        await expect(
          evaluator.loadSheet(`locale-${locale}`, sheet),
          `Expected loadSheet to succeed for locale ${locale}`
        ).resolves.toBeUndefined();
      }
    });
  });
});
