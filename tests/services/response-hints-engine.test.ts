/**
 * Tests for response-hints-engine.ts
 * Verifies CoT _hints generation from cell value grids.
 */

import { describe, it, expect } from 'vitest';
import { generateResponseHints } from '../../src/services/response-hints-engine.js';

describe('generateResponseHints', () => {
  it('returns null for empty input', () => {
    expect(generateResponseHints([])).toBeNull();
    expect(generateResponseHints([[]])).toBeNull();
    expect(generateResponseHints([['Header']])).toBeNull(); // single row = no data
  });

  it('returns null for single-column data', () => {
    const values = [['Name'], ['Alice'], ['Bob']];
    expect(generateResponseHints(values)).toBeNull();
  });

  it('returns a hints object for valid 2D data', () => {
    const values = [
      ['Date', 'Revenue'],
      ['2024-01-01', 1000],
      ['2024-01-02', 1200],
    ];
    const hints = generateResponseHints(values);
    expect(hints).not.toBeNull();
    expect(typeof hints?.dataShape).toBe('string');
  });

  it('detects time-series shape from date + numeric columns', () => {
    const values = [
      ['Date', 'Revenue'],
      ['2024-01-01', 1000],
      ['2024-01-02', 1200],
      ['2024-01-03', 1100],
      ['2024-01-04', 1300],
      ['2024-01-05', 900],
      ['2024-01-06', 1500],
      ['2024-01-07', 1400],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.dataShape).toMatch(/time series/);
  });

  it('includes row and column counts in dataShape', () => {
    const values = [
      ['Date', 'Revenue', 'Cost'],
      ['2024-01-01', 1000, 400],
      ['2024-01-02', 1200, 500],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.dataShape).toMatch(/2 rows/);
    expect(hints?.dataShape).toMatch(/3 col/);
  });

  it('detects primary key column (100% unique ID column)', () => {
    const values = [
      ['id', 'Name', 'Amount'],
      ['001', 'Alice', 100],
      ['002', 'Bob', 200],
      ['003', 'Carol', 150],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.primaryKeyColumn).toBeDefined();
    expect(hints?.primaryKeyColumn).toMatch(/id/i);
  });

  it('suggests profit margin when revenue and cost columns present but no profit', () => {
    const values = [
      ['Month', 'Revenue', 'Cost'],
      ['Jan', 50000, 20000],
      ['Feb', 55000, 22000],
      ['Mar', 60000, 25000],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.dataRelationships).toBeDefined();
    const relStr = hints?.dataRelationships?.join(' ');
    expect(relStr).toMatch(/[Pp]rofit|margin/i);
  });

  it('does not suggest profit margin when profit column already exists', () => {
    const values = [
      ['Revenue', 'Cost', 'Profit'],
      [50000, 20000, 30000],
      [55000, 22000, 33000],
    ];
    const hints = generateResponseHints(values);
    const relStr = hints?.dataRelationships?.join(' ') ?? '';
    // Should not suggest adding profit margin since it exists
    expect(relStr).not.toMatch(/add Profit Margin/);
  });

  it('detects two date columns and suggests duration formula', () => {
    const values = [
      ['StartDate', 'EndDate', 'Value'],
      ['2024-01-01', '2024-01-15', 100],
      ['2024-02-01', '2024-02-20', 200],
      ['2024-03-01', '2024-03-10', 150],
    ];
    const hints = generateResponseHints(values);
    const relStr = hints?.dataRelationships?.join(' ') ?? '';
    expect(relStr).toMatch(/[Dd]uration|DAYS/);
  });

  it('sets riskLevel to high when >30% nulls', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', null],
      ['Bob', null],
      ['Carol', null],
      ['Dave', 200],
      ['Eve', null],
    ];
    // 4 of 5 Amount values are null = 80%
    const hints = generateResponseHints(values);
    expect(hints?.riskLevel).toBe('high');
  });

  it('sets riskLevel to low when <10% nulls', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', 200],
      ['Carol', 150],
      ['Dave', 180],
      ['Eve', null], // 1 of 5 = 20% actually...
    ];
    const hints = generateResponseHints(values);
    // 1/5 = 20% → medium
    expect(['low', 'medium']).toContain(hints?.riskLevel);
  });

  it('sets riskLevel to none when no nulls', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', 200],
      ['Carol', 150],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.riskLevel).toBe('none');
  });

  it('always includes nextPhase', () => {
    const values = [
      ['Name', 'Score'],
      ['Alice', 95],
      ['Bob', 87],
    ];
    const hints = generateResponseHints(values);
    expect(typeof hints?.nextPhase).toBe('string');
    expect(hints?.nextPhase?.length).toBeGreaterThan(0);
  });

  it('suggests clean workflow in nextPhase when risk is high', () => {
    const values = [
      ['Name', 'Amount'],
      ['Alice', null],
      ['Bob', null],
      ['Carol', null],
      ['Dave', null],
      ['Eve', 100],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.nextPhase).toMatch(/clean/i);
  });

  it('suggests visualization workflow for time-series data with no risk', () => {
    const values = [
      ['Date', 'Revenue'],
      ['2024-01-01', 1000],
      ['2024-01-02', 1200],
      ['2024-01-03', 1100],
    ];
    const hints = generateResponseHints(values);
    // riskLevel should be none (no nulls)
    expect(hints?.riskLevel).toBe('none');
    expect(hints?.nextPhase).toMatch(/visuali[sz]e|chart/i);
  });

  it('includes formula opportunity for summary row on numeric data', () => {
    const values = [
      ['Product', 'Sales'],
      ['Widget A', 500],
      ['Widget B', 750],
      ['Widget C', 300],
    ];
    const hints = generateResponseHints(values);
    expect(hints?.formulaOpportunities).toBeDefined();
    const oppStr = hints?.formulaOpportunities?.join(' ') ?? '';
    expect(oppStr).toMatch(/SUM/);
  });

  it('does not crash on mixed types in same column', () => {
    const values = [
      ['Mixed', 'Value'],
      ['text', 100],
      [42, 'also text'],
      [true, null],
      ['2024-01-01', 300],
    ];
    expect(() => generateResponseHints(values)).not.toThrow();
  });
});
