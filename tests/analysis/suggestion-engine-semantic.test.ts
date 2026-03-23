/**
 * Tests for semantic column group detection and the 15 new suggestion rules
 * added in Task C3.
 *
 * These tests import the suggestion engine functions indirectly via a ScoutResult
 * mock and verify that detectSemanticPatterns fires the right rules.
 */

import { describe, it, expect, vi } from 'vitest';
import { SuggestionEngine } from '../../src/analysis/suggestion-engine.js';
import type { ScoutResult } from '../../src/analysis/scout.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/services/session-context.js', () => ({
  getSessionContext: vi.fn().mockReturnValue({
    shouldAvoidSuggestion: vi.fn().mockResolvedValue(false),
    getRecentAnalysis: vi.fn().mockReturnValue(undefined),
  }),
}));

vi.mock('../../src/utils/request-context.js', () => ({
  sendProgress: vi.fn(),
  getRequestContext: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Helper: build a minimal ScoutResult for testing
// ---------------------------------------------------------------------------

function buildScoutResult(overrides: Partial<ScoutResult> = {}): ScoutResult {
  const base: ScoutResult = {
    spreadsheetId: 'test-spreadsheet-id',
    title: 'Test Spreadsheet',
    sheets: [
      {
        sheetId: 0,
        title: 'Sheet1',
        rowCount: 100,
        columnCount: 5,
        estimatedCells: 500,
      },
    ],
    indicators: {
      sizeCategory: 'tiny',
      estimatedCells: 500,
      complexityScore: 20,
      hasFormulas: false,
      hasVisualizations: false,
      hasDataQuality: false,
      multiSheet: false,
      recommendedDepth: 'sample',
    },
    columnTypes: [],
    detectedIntent: 'quick',
    intentConfidence: 0.8,
    intentReason: 'test',
    recommendations: [],
    nextActions: { recommended: null, alternatives: [] },
    retrievedAt: Date.now(),
    latencyMs: 10,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Helpers: build a Scout mock that returns a given ScoutResult
// ---------------------------------------------------------------------------

function buildEngine(scoutResult: ScoutResult): SuggestionEngine {
  const mockScout = {
    scout: vi.fn().mockResolvedValue(scoutResult),
  };
  const mockActionGenerator = {
    generate: vi.fn().mockResolvedValue([]),
  };
  return new SuggestionEngine({
    scout: mockScout as never,
    actionGenerator: mockActionGenerator as never,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectSemanticPatterns — Rule 1: revenue_cost_present', () => {
  it('fires when both revenue and cost columns are present', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'Revenue', detectedType: 'number', nullable: false },
        { index: 1, header: 'Cost', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({
      spreadsheetId: 'test-id',
      maxSuggestions: 20,
    });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('revenue_cost_present');
  });

  it('does not fire when only revenue column is present', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [{ index: 0, header: 'Revenue', detectedType: 'number', nullable: false }],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).not.toContain('revenue_cost_present');
  });
});

describe('detectSemanticPatterns — Rule 2: temporal_financial', () => {
  it('fires when date and revenue columns both present', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'Date', detectedType: 'date', nullable: false },
        { index: 1, header: 'Revenue', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('temporal_financial');
  });
});

describe('detectSemanticPatterns — Rule 3: category_numeric', () => {
  it('fires when categorical and numeric columns present', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'Department', detectedType: 'text', nullable: false },
        { index: 1, header: 'Revenue', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('category_numeric');
    const suggestion = result.suggestions.find((s) => s.id === 'category_numeric');
    expect(suggestion?.action.tool).toBe('sheets_visualize');
  });
});

describe('detectSemanticPatterns — Rule 7: date_unsorted', () => {
  it('fires when a date-type column is present', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'created_at', detectedType: 'date', nullable: false },
        { index: 1, header: 'Amount', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('date_unsorted');
    const suggestion = result.suggestions.find((s) => s.id === 'date_unsorted');
    expect(suggestion?.action.action).toBe('sort_range');
  });
});

describe('detectSemanticPatterns — Rule 12: date_no_derivation', () => {
  it('fires when date column present but no year/month/quarter column', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'SaleDate', detectedType: 'date', nullable: false },
        { index: 1, header: 'Amount', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('date_no_derivation');
  });

  it('does not fire when year column already exists', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'SaleDate', detectedType: 'date', nullable: false },
        { index: 1, header: 'Year', detectedType: 'number', nullable: false },
        { index: 2, header: 'Amount', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).not.toContain('date_no_derivation');
  });
});

describe('detectSemanticPatterns — Rule 13: numeric_no_footer', () => {
  it('fires when numeric columns present and row count > 5', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'Name', detectedType: 'text', nullable: false },
        { index: 1, header: 'Sales', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('numeric_no_footer');
    const suggestion = result.suggestions.find((s) => s.id === 'numeric_no_footer');
    expect(suggestion?.category).toBe('formulas');
  });
});

describe('detectSemanticPatterns — Rule 15: many_sheets', () => {
  it('fires when 4+ sheets with no Index/TOC', async () => {
    const scoutResult = buildScoutResult({
      sheets: [
        { sheetId: 0, title: 'Q1', rowCount: 50, columnCount: 4, estimatedCells: 200 },
        { sheetId: 1, title: 'Q2', rowCount: 50, columnCount: 4, estimatedCells: 200 },
        { sheetId: 2, title: 'Q3', rowCount: 50, columnCount: 4, estimatedCells: 200 },
        { sheetId: 3, title: 'Q4', rowCount: 50, columnCount: 4, estimatedCells: 200 },
      ],
      columnTypes: [{ index: 0, header: 'Amount', detectedType: 'number', nullable: false }],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('many_sheets');
    const suggestion = result.suggestions.find((s) => s.id === 'many_sheets');
    expect(suggestion?.action.params).toMatchObject({ sheetName: 'Index' });
  });

  it('does not fire when Index sheet already exists', async () => {
    const scoutResult = buildScoutResult({
      sheets: [
        { sheetId: 0, title: 'Index', rowCount: 5, columnCount: 2, estimatedCells: 10 },
        { sheetId: 1, title: 'Q1', rowCount: 50, columnCount: 4, estimatedCells: 200 },
        { sheetId: 2, title: 'Q2', rowCount: 50, columnCount: 4, estimatedCells: 200 },
        { sheetId: 3, title: 'Q3', rowCount: 50, columnCount: 4, estimatedCells: 200 },
      ],
      columnTypes: [{ index: 0, header: 'Amount', detectedType: 'number', nullable: false }],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).not.toContain('many_sheets');
  });
});

describe('detectSemanticPatterns — Rule 4: id_multi_sheet', () => {
  it('fires when identifier column present and multiple sheets', async () => {
    // Use 'OrderCode' — 'code' is in the identifier group keywords and
    // does not conflict with categorical ('category','type','status','region',
    // 'department','product','tier','segment')
    const scoutResult = buildScoutResult({
      sheets: [
        { sheetId: 0, title: 'Orders', rowCount: 100, columnCount: 4, estimatedCells: 400 },
        { sheetId: 1, title: 'Lookup', rowCount: 50, columnCount: 3, estimatedCells: 150 },
      ],
      columnTypes: [
        { index: 0, header: 'OrderCode', detectedType: 'text', nullable: false },
        { index: 1, header: 'Quantity', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const ids = result.suggestions.map((s) => s.id);
    expect(ids).toContain('id_multi_sheet');
  });
});

describe('suggestion confidence and category correctness', () => {
  it('revenue_cost_present has confidence 0.92 and category formulas', async () => {
    const scoutResult = buildScoutResult({
      columnTypes: [
        { index: 0, header: 'Revenue', detectedType: 'number', nullable: false },
        { index: 1, header: 'Cost', detectedType: 'number', nullable: false },
      ],
    });
    const engine = buildEngine(scoutResult);
    const result = await engine.suggest({ spreadsheetId: 'test-id', maxSuggestions: 20 });
    const s = result.suggestions.find((s) => s.id === 'revenue_cost_present');
    expect(s).toBeDefined();
    expect(s!.confidence).toBe(0.92);
    expect(s!.category).toBe('formulas');
    expect(s!.impact).toBe('low_risk');
  });
});
