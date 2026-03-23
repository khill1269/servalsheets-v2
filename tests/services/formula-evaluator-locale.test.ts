/**
 * Formula Evaluator — Locale Awareness Tests (ISSUE-086)
 *
 * Verifies that localeToHfOptions correctly maps Google Sheets locale strings
 * to HyperFormula separator configuration.
 */

import { describe, it, expect } from 'vitest';
import { localeToHfOptions } from '../../src/services/formula-evaluator.js';

describe('localeToHfOptions', () => {
  it('returns dot-decimal, comma-arg for en_US', () => {
    const opts = localeToHfOptions('en_US');
    expect(opts.functionArgSeparator).toBe(',');
    expect(opts.decimalSeparator).toBe('.');
  });

  it('returns semicolon-arg, comma-decimal for fr_FR', () => {
    const opts = localeToHfOptions('fr_FR');
    expect(opts.functionArgSeparator).toBe(';');
    expect(opts.decimalSeparator).toBe(',');
  });

  it('returns semicolon-arg, comma-decimal for de_DE', () => {
    const opts = localeToHfOptions('de_DE');
    expect(opts.functionArgSeparator).toBe(';');
    expect(opts.decimalSeparator).toBe(',');
  });

  it('returns dot-decimal, comma-arg for undefined locale', () => {
    const opts = localeToHfOptions(undefined);
    expect(opts.functionArgSeparator).toBe(',');
    expect(opts.decimalSeparator).toBe('.');
  });

  it('returns dot-decimal, comma-arg for unknown locale xx_XX', () => {
    const opts = localeToHfOptions('xx_XX');
    expect(opts.functionArgSeparator).toBe(',');
    expect(opts.decimalSeparator).toBe('.');
  });

  it('returns semicolon-arg for es_ES (Spanish)', () => {
    const opts = localeToHfOptions('es_ES');
    expect(opts.functionArgSeparator).toBe(';');
    expect(opts.decimalSeparator).toBe(',');
  });

  it('returns semicolon-arg for pt_BR (Brazilian Portuguese)', () => {
    const opts = localeToHfOptions('pt_BR');
    expect(opts.functionArgSeparator).toBe(';');
    expect(opts.decimalSeparator).toBe(',');
  });

  it('returns dot-decimal, comma-arg for en_GB', () => {
    const opts = localeToHfOptions('en_GB');
    expect(opts.functionArgSeparator).toBe(',');
    expect(opts.decimalSeparator).toBe('.');
  });

  it('does not set thousandSeparator equal to functionArgSeparator (HF constraint)', () => {
    // Verify the HyperFormula constraint: functionArgSeparator !== thousandSeparator
    const locales = ['en_US', 'fr_FR', 'de_DE', 'de_CH', 'fr_CH', undefined, 'es_MX'];
    for (const locale of locales) {
      const opts = localeToHfOptions(locale);
      expect(opts.functionArgSeparator).not.toBe(opts.thousandSeparator);
    }
  });

  it('returns space thousand separator for Swiss locales (de_CH)', () => {
    const opts = localeToHfOptions('de_CH');
    expect(opts.thousandSeparator).toBe(' ');
  });
});
