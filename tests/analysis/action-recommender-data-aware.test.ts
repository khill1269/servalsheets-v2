/**
 * Tests for data-aware extension of action-recommender.
 * Written FIRST per TDD workflow.
 */

import { describe, it, expect } from 'vitest';
import {
  getRecommendedActions,
  getDataAwareSuggestions,
  type SuggestedAction,
} from '../../src/services/action-recommender.js';
import type { CellValue } from '../../src/schemas/shared.js';

describe('getRecommendedActions (existing static rules)', () => {
  it('returns static rules for sheets_data.read', () => {
    const suggestions = getRecommendedActions('sheets_data', 'read');
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].tool).toBeTruthy();
    expect(suggestions[0].action).toBeTruthy();
  });

  it('returns empty array for unknown tool+action', () => {
    const suggestions = getRecommendedActions('unknown_tool', 'unknown_action');
    expect(suggestions).toHaveLength(0);
  });
});

describe('getDataAwareSuggestions', () => {
  it('returns static rules when no responseValues provided', () => {
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {});
    // Should still return the static rules
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('prepends chart suggestion when data has date-like and numeric columns', () => {
    const values: CellValue[][] = [
      ['Date', 'Revenue'],
      ['2024-01-01', 1000],
      ['2024-01-02', 1200],
      ['2024-01-03', 1100],
      ['2024-01-04', 1300],
    ];
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { responseValues: values });
    expect(Array.isArray(suggestions)).toBe(true);
    const chartSuggestion = suggestions.find(
      (s: SuggestedAction) => s.tool === 'sheets_visualize' && s.action === 'suggest_chart'
    );
    expect(chartSuggestion).toBeDefined();
  });

  it('prepends formula suggestion when data contains VLOOKUP strings', () => {
    const values: CellValue[][] = [
      ['Name', 'Lookup'],
      ['Alice', '=VLOOKUP(A2,Data!A:B,2,0)'],
      ['Bob', '=VLOOKUP(A3,Data!A:B,2,0)'],
    ];
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { responseValues: values });
    const formulaSuggestion = suggestions.find(
      (s: SuggestedAction) => s.tool === 'sheets_analyze' && s.action === 'analyze_formulas'
    );
    expect(formulaSuggestion).toBeDefined();
  });

  it('prepends sort suggestion when date column values are not in order', () => {
    const values: CellValue[][] = [
      ['Date', 'Value'],
      ['2024-01-03', 100],
      ['2024-01-01', 200],  // out of order
      ['2024-01-02', 150],
      ['2024-01-05', 300],
      ['2024-01-04', 250],
    ];
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { responseValues: values });
    const sortSuggestion = suggestions.find(
      (s: SuggestedAction) => s.tool === 'sheets_dimensions' && s.action === 'sort_range'
    );
    expect(sortSuggestion).toBeDefined();
  });

  it('prepends fill_missing suggestion when >10% of non-header cells are null', () => {
    const values: CellValue[][] = [
      ['Name', 'Amount'],
      ['Alice', 100],
      ['Bob', null],
      ['Carol', null],
      ['Dave', null],
      ['Eve', 200],
    ];
    // 3 of 5 Amount values are null = 60% — well over 10%
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { responseValues: values });
    const fillSuggestion = suggestions.find(
      (s: SuggestedAction) => s.tool === 'sheets_fix' && s.action === 'fill_missing'
    );
    expect(fillSuggestion).toBeDefined();
  });

  it('includes confidence gap suggestions when confidenceGaps provided', () => {
    const gaps = [
      { question: 'What formula should be used here?', options: ['SUM', 'AVERAGE'] },
    ];
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { confidenceGaps: gaps });
    expect(Array.isArray(suggestions)).toBe(true);
    // Should contain at least one suggestion related to the gap
    const gapSuggestion = suggestions.find(
      (s: SuggestedAction) => s.reason && s.reason.includes('formula')
    );
    expect(gapSuggestion).toBeDefined();
  });

  it('limits confidence gap suggestions to 3', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => ({
      question: `column type question ${i}`,
    }));
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { confidenceGaps: gaps });
    // Total suggestions should be reasonable — not 10+ from gaps alone
    const gapSuggestions = suggestions.filter(
      (s: SuggestedAction) => s.reason && s.reason.includes('question')
    );
    expect(gapSuggestions.length).toBeLessThanOrEqual(3);
  });

  it('does not duplicate suggestions', () => {
    const values: CellValue[][] = [
      ['Date', 'Revenue'],
      ['2024-01-01', 1000],
      ['2024-01-02', 1200],
      ['2024-01-03', 1100],
    ];
    const suggestions = getDataAwareSuggestions('sheets_data', 'read', {}, { responseValues: values });
    const keys = suggestions.map((s: SuggestedAction) => `${s.tool}.${s.action}`);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});

describe('getRecommendedActions — previously uncovered actions', () => {
  it('cross_write: suggests cross_read to verify + cross_compare to diff', () => {
    const suggestions = getRecommendedActions('sheets_data', 'cross_write');
    expect(suggestions.length).toBeGreaterThan(0);
    const tools = suggestions.map((s) => `${s.tool}.${s.action}`);
    expect(tools).toContain('sheets_data.cross_read');
    expect(tools).toContain('sheets_data.cross_compare');
  });

  it('cross_query: suggests cross_read for raw data + scout for structure', () => {
    const suggestions = getRecommendedActions('sheets_data', 'cross_query');
    expect(suggestions.length).toBeGreaterThan(0);
    const tools = suggestions.map((s) => `${s.tool}.${s.action}`);
    expect(tools).toContain('sheets_data.cross_read');
    expect(tools).toContain('sheets_analyze.scout');
  });

  it('quick_insights: suggests comprehensive for deeper analysis + suggest_cleaning', () => {
    const suggestions = getRecommendedActions('sheets_analyze', 'quick_insights');
    expect(suggestions.length).toBeGreaterThan(0);
    const tools = suggestions.map((s) => `${s.tool}.${s.action}`);
    expect(tools).toContain('sheets_analyze.comprehensive');
    expect(tools).toContain('sheets_fix.suggest_cleaning');
  });

  it('auto_enhance: suggests suggest_next_actions + suggest_chart', () => {
    const suggestions = getRecommendedActions('sheets_analyze', 'auto_enhance');
    expect(suggestions.length).toBeGreaterThan(0);
    const tools = suggestions.map((s) => `${s.tool}.${s.action}`);
    expect(tools).toContain('sheets_analyze.suggest_next_actions');
    expect(tools).toContain('sheets_visualize.suggest_chart');
  });

  it('federation.call_remote: suggests write to store results + get_context', () => {
    const suggestions = getRecommendedActions('sheets_federation', 'call_remote');
    expect(suggestions.length).toBeGreaterThan(0);
    const tools = suggestions.map((s) => `${s.tool}.${s.action}`);
    expect(tools).toContain('sheets_data.write');
    expect(tools).toContain('sheets_session.get_context');
  });

  it('each new rule returns suggestions with non-empty tool, action, and reason', () => {
    const newActions: [string, string][] = [
      ['sheets_data', 'cross_write'],
      ['sheets_data', 'cross_query'],
      ['sheets_analyze', 'quick_insights'],
      ['sheets_analyze', 'auto_enhance'],
      ['sheets_federation', 'call_remote'],
    ];
    for (const [tool, action] of newActions) {
      const suggestions = getRecommendedActions(tool, action);
      for (const s of suggestions) {
        expect(s.tool).toBeTruthy();
        expect(s.action).toBeTruthy();
        expect(s.reason).toBeTruthy();
      }
    }
  });
});
