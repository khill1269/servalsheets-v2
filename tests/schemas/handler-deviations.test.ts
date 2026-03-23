/**
 * Handler Deviations Validation Tests
 *
 * Ensures ACCEPTABLE_DEVIATIONS is properly structured and validated.
 */

import { describe, test, expect } from 'vitest';
import {
  ACCEPTABLE_DEVIATIONS,
  KNOWN_PROTOCOL_DEVIATIONS,
  getToolDeviation,
  getProtocolDeviation,
  isCaseDeviationDocumented,
  getToolsWithDeviations,
  validateDeviation,
  type HandlerDeviation,
} from '../../src/schemas/handler-deviations.js';

describe('Handler Deviations Structure', () => {
  test('ACCEPTABLE_DEVIATIONS is an array', () => {
    expect(Array.isArray(ACCEPTABLE_DEVIATIONS)).toBe(true);
  });

  test('each deviation has required fields', () => {
    for (const deviation of ACCEPTABLE_DEVIATIONS) {
      expect(typeof deviation.tool).toBe('string');
      expect(deviation.tool.length).toBeGreaterThan(0);
      expect(typeof deviation.reason).toBe('string');
      expect(deviation.reason.length).toBeGreaterThan(0);
      expect(typeof deviation.justification).toBe('string');
      expect(deviation.justification.length).toBeGreaterThan(0);
      expect(typeof deviation.addedDate).toBe('string');
      expect(deviation.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('each deviation has at least one deviation list', () => {
    for (const deviation of ACCEPTABLE_DEVIATIONS) {
      const hasExtraCases = deviation.extraCases && deviation.extraCases.length > 0;
      const hasMissingCases = deviation.missingCases && deviation.missingCases.length > 0;
      expect(hasExtraCases || hasMissingCases).toBe(true);
    }
  });

  test('no duplicate tool names in deviations', () => {
    const tools = ACCEPTABLE_DEVIATIONS.map((d) => d.tool);
    const uniqueTools = new Set(tools);
    expect(tools.length).toBe(uniqueTools.size);
  });

  test('justifications are not trivial', () => {
    for (const deviation of ACCEPTABLE_DEVIATIONS) {
      // Justification should be more than just reason repeated
      expect(deviation.justification.trim().length).toBeGreaterThan(50);
      expect(deviation.justification.toLowerCase()).not.toBe(deviation.reason.toLowerCase());
    }
  });
});

describe('sheets_core deviations', () => {
  test('sheets_core has documented deviations', () => {
    const deviation = getToolDeviation('core');
    expect(deviation).toBeDefined();
    expect(deviation?.tool).toBe('core');
  });

  test('sheets_core has 6 documented alias cases', () => {
    const deviation = getToolDeviation('core');
    expect(deviation?.extraCases).toHaveLength(6);
    expect(deviation?.extraCases).toEqual(
      expect.arrayContaining([
        'copy_to',
        'hide_sheet',
        'rename_sheet',
        'show_sheet',
        'unhide_sheet',
        'update_sheet_properties',
      ])
    );
  });

  test('all core aliases are documented', () => {
    const aliases = [
      'copy_to',
      'hide_sheet',
      'rename_sheet',
      'show_sheet',
      'unhide_sheet',
      'update_sheet_properties',
    ];

    for (const alias of aliases) {
      expect(isCaseDeviationDocumented('core', alias)).toBe(true);
    }
  });

  test('undocumented cases return false', () => {
    expect(isCaseDeviationDocumented('core', 'not_a_real_case')).toBe(false);
    expect(isCaseDeviationDocumented('core', 'create')).toBe(false); // Valid action but not a deviation
  });
});

describe('getToolsWithDeviations', () => {
  test('returns array of tool names', () => {
    const tools = getToolsWithDeviations();
    expect(Array.isArray(tools)).toBe(true);
  });

  test('includes core tool', () => {
    const tools = getToolsWithDeviations();
    expect(tools).toContain('core');
  });
});

describe('Protocol deviations registry', () => {
  test('ISSUE-255 non-fatal tool error deviation is documented', () => {
    const deviation = getProtocolDeviation('ISSUE-255');
    expect(deviation).toBeDefined();
    expect(deviation?.area).toBe('mcp');
    expect(deviation?.behavior).toMatch(/isError/i);
    expect(deviation?.control).toMatch(/MCP_NON_FATAL_TOOL_ERRORS=false/);
  });

  test('protocol deviation entries have required audit fields', () => {
    for (const deviation of KNOWN_PROTOCOL_DEVIATIONS) {
      expect(typeof deviation.id).toBe('string');
      expect(deviation.id.length).toBeGreaterThan(0);
      expect(typeof deviation.specExpectation).toBe('string');
      expect(deviation.specExpectation.length).toBeGreaterThan(20);
      expect(typeof deviation.actualBehavior).toBe('string');
      expect(deviation.actualBehavior.length).toBeGreaterThan(20);
      expect(typeof deviation.rationale).toBe('string');
      expect(deviation.rationale.length).toBeGreaterThan(20);
      expect(typeof deviation.addedDate).toBe('string');
      expect(deviation.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('validateDeviation', () => {
  test('valid deviation passes validation', () => {
    const validDeviation: HandlerDeviation = {
      tool: 'test',
      reason: 'Testing',
      extraCases: ['test_case'],
      justification:
        'This is a detailed justification explaining why this deviation exists and is acceptable.',
      addedDate: '2026-02-17',
    };

    const result = validateDeviation(validDeviation);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('missing tool fails validation', () => {
    const invalid: HandlerDeviation = {
      tool: '',
      reason: 'Testing',
      justification: 'Justification',
      addedDate: '2026-02-17',
      extraCases: ['test'],
    };

    const result = validateDeviation(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('tool is required');
  });

  test('missing reason fails validation', () => {
    const invalid: HandlerDeviation = {
      tool: 'test',
      reason: '',
      justification: 'Justification',
      addedDate: '2026-02-17',
      extraCases: ['test'],
    };

    const result = validateDeviation(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('reason is required');
  });

  test('missing justification fails validation', () => {
    const invalid: HandlerDeviation = {
      tool: 'test',
      reason: 'Reason',
      justification: '',
      addedDate: '2026-02-17',
      extraCases: ['test'],
    };

    const result = validateDeviation(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('justification is required');
  });

  test('invalid date format fails validation', () => {
    const invalid: HandlerDeviation = {
      tool: 'test',
      reason: 'Reason',
      justification: 'Justification',
      addedDate: '02-17-2026', // Wrong format
      extraCases: ['test'],
    };

    const result = validateDeviation(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('addedDate must be in YYYY-MM-DD format');
  });

  test('missing both deviation lists fails validation', () => {
    const invalid: HandlerDeviation = {
      tool: 'test',
      reason: 'Reason',
      justification: 'Justification',
      addedDate: '2026-02-17',
    };

    const result = validateDeviation(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('at least one of extraCases or missingCases is required');
  });

  test('empty deviation lists fail validation', () => {
    const invalid: HandlerDeviation = {
      tool: 'test',
      reason: 'Reason',
      justification: 'Justification',
      addedDate: '2026-02-17',
      extraCases: [],
      missingCases: [],
    };

    const result = validateDeviation(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deviation lists cannot be empty arrays');
  });
});

describe('All ACCEPTABLE_DEVIATIONS pass validation', () => {
  test('every documented deviation is valid', () => {
    for (const deviation of ACCEPTABLE_DEVIATIONS) {
      const result = validateDeviation(deviation);
      if (!result.valid) {
        console.error(`Invalid deviation for tool ${deviation.tool}:`, result.errors);
      }
      expect(result.valid).toBe(true);
    }
  });
});
