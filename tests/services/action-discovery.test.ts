import { describe, it, expect } from 'vitest';

import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import {
  analyzeDiscoveryQuery,
  TOOL_CATEGORIES,
  discoverActions,
  getCategories,
} from '../../src/services/action-discovery.js';

describe('Action Discovery Configuration', () => {
  it('should provide category mappings for every registered tool', () => {
    const missing = Object.keys(TOOL_ACTIONS).filter((tool) => !(tool in TOOL_CATEGORIES));
    expect(missing).toEqual([]);
  });

  it('should expose stable high-level categories', () => {
    expect(getCategories()).toEqual([
      'data',
      'format',
      'analysis',
      'structure',
      'collaboration',
      'automation',
    ]);
  });
});

describe('Action Discovery Ranking', () => {
  it('prefers Drive listing for spreadsheet listing intents', () => {
    const matches = discoverActions('list spreadsheets in drive', 'all', 3);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toMatchObject({
      tool: 'sheets_core',
      action: 'list',
    });
  });

  it('prefers tab listing for sheet/tab listing intents', () => {
    const matches = discoverActions('list all tabs in this spreadsheet', 'all', 3);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toMatchObject({
      tool: 'sheets_core',
      action: 'list_sheets',
    });
  });

  it('routes merge-cells intent to merge_cells action', () => {
    const matches = discoverActions('merge these cells', 'all', 3);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toMatchObject({
      tool: 'sheets_data',
      action: 'merge_cells',
    });
  });

  it('respects category filters', () => {
    const matches = discoverActions('create a chart from revenue data', 'analysis', 5);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((match) => TOOL_CATEGORIES[match.tool] === 'analysis')).toBe(true);
  });

  it('flags underspecified list queries for clarification', () => {
    const matches = discoverActions('list', 'all', 5);
    const guidance = analyzeDiscoveryQuery('list', matches);

    expect(guidance.needsClarification).toBe(true);
    expect(guidance.clarificationReason).toBe('underspecified_query');
    expect(guidance.clarificationQuestion).toContain('list');
    expect(guidance.clarificationOptions?.length ?? 0).toBeGreaterThan(0);
  });

  it('does not require clarification for specific intents', () => {
    const matches = discoverActions('merge these cells', 'all', 5);
    const guidance = analyzeDiscoveryQuery('merge these cells', matches);

    expect(guidance.needsClarification).toBe(false);
  });
});
