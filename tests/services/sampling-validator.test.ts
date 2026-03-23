import { describe, it, expect, vi } from 'vitest';
import { validateSamplingOutput, SamplingOutputSchemas } from '../../src/services/sampling-validator.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

describe('validateSamplingOutput', () => {
  describe('suggest_format', () => {
    it('parses valid output', () => {
      const raw = JSON.stringify({
        suggestions: [{ description: 'Bold headers', range: 'A1:Z1', formatType: 'bold' }],
      });
      const result = validateSamplingOutput('suggest_format', raw);
      expect(result).not.toBeNull();
      expect(result!.suggestions).toHaveLength(1);
      expect(result!.suggestions[0].description).toBe('Bold headers');
    });

    it('returns null for empty suggestions array', () => {
      const raw = JSON.stringify({ suggestions: [] });
      const result = validateSamplingOutput('suggest_format', raw);
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const result = validateSamplingOutput('suggest_format', 'not valid json{');
      expect(result).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      const raw = JSON.stringify({ unrelated: 'field' });
      const result = validateSamplingOutput('suggest_format', raw);
      expect(result).toBeNull();
    });
  });

  describe('model_scenario', () => {
    it('parses valid output with all fields', () => {
      const raw = JSON.stringify({
        narrative: 'Revenue drops 20%, causing cascade to profit margin',
        riskLevel: 'high',
        impacts: [{ cell: 'B5', delta: -20000 }],
        affectedCount: 47,
      });
      const result = validateSamplingOutput('model_scenario', raw);
      expect(result).not.toBeNull();
      expect(result!.narrative).toContain('Revenue');
      expect(result!.riskLevel).toBe('high');
      expect(result!.impacts).toHaveLength(1);
    });

    it('parses with optional impacts defaulting to []', () => {
      const raw = JSON.stringify({
        narrative: 'Minor impact scenario with no cell changes tracked',
        riskLevel: 'low',
      });
      const result = validateSamplingOutput('model_scenario', raw);
      expect(result).not.toBeNull();
      expect(result!.impacts).toEqual([]);
    });

    it('returns null when riskLevel is invalid enum value', () => {
      const raw = JSON.stringify({
        narrative: 'Some narrative here',
        riskLevel: 'critical',
      });
      const result = validateSamplingOutput('model_scenario', raw);
      expect(result).toBeNull();
    });
  });

  describe('diff_revisions', () => {
    it('parses valid output', () => {
      const raw = JSON.stringify({
        summary: 'Column D values changed',
        likelyCause: 'Manual data entry correction',
        changes: [{ cell: 'D15', before: 5000, after: 500 }],
      });
      const result = validateSamplingOutput('diff_revisions', raw);
      expect(result).not.toBeNull();
      expect(result!.summary).toBe('Column D values changed');
    });
  });

  describe('find_replace_estimate', () => {
    it('parses valid output', () => {
      const raw = JSON.stringify({ estimatedReplacements: 5, confidence: 0.9 });
      const result = validateSamplingOutput('find_replace_estimate', raw);
      expect(result).not.toBeNull();
      expect(result!.estimatedReplacements).toBe(5);
    });

    it('returns null when estimatedReplacements is negative', () => {
      const raw = JSON.stringify({ estimatedReplacements: -1 });
      const result = validateSamplingOutput('find_replace_estimate', raw);
      expect(result).toBeNull();
    });
  });

  describe('comment_add_reply', () => {
    it('parses valid output', () => {
      const raw = JSON.stringify({ reply: 'Thanks for the update!', tone: 'friendly' });
      const result = validateSamplingOutput('comment_add_reply', raw);
      expect(result).not.toBeNull();
      expect(result!.reply).toBe('Thanks for the update!');
      expect(result!.tone).toBe('friendly');
    });

    it('returns null when reply is empty string', () => {
      const raw = JSON.stringify({ reply: '' });
      const result = validateSamplingOutput('comment_add_reply', raw);
      expect(result).toBeNull();
    });
  });
});

describe('SamplingOutputSchemas', () => {
  it('exports all 5 schema keys', () => {
    const keys = Object.keys(SamplingOutputSchemas);
    expect(keys).toContain('suggest_format');
    expect(keys).toContain('model_scenario');
    expect(keys).toContain('diff_revisions');
    expect(keys).toContain('comment_add_reply');
    expect(keys).toContain('find_replace_estimate');
  });
});
