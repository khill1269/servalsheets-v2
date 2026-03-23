/**
 * Validation Engine Bug Fix Tests
 *
 * Tests for bug fix 0.2: Invalid rule IDs should return clear error instead of 0 checks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationEngine } from '../../src/services/validation-engine.js';

describe('ValidationEngine - Bug Fix 0.2', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine({ enabled: true });
  });

  describe('invalid rule IDs (BUG FIX 0.2)', () => {
    it('should return error when requested rules do not exist', async () => {
      // Test the bug: passing invalid rule IDs like "not_empty" and "valid_email"
      // instead of the correct "builtin_non_empty_string" and "builtin_email"
      const result = await engine.validate('test@example.com', {
        rules: ['not_empty', 'valid_email'], // Invalid rule IDs
      });

      // Should return error, not silently pass with 0 checks
      expect(result.valid).toBe(false);
      expect(result.totalChecks).toBe(0);
      expect(result.passedChecks).toBe(0);
      expect(result.errors).toHaveLength(1);

      const error = result.errors[0];
      expect(error?.message).toContain('None of the requested rule IDs matched');
      expect(error?.message).toContain('not_empty');
      expect(error?.message).toContain('valid_email');
      expect(error?.message).toContain('builtin_'); // Should mention available rules
    });

    it('should list available rule IDs in error message', async () => {
      const result = await engine.validate('test', {
        rules: ['invalid_rule'], // Invalid rule ID
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);

      const error = result.errors[0];
      expect(error?.message).toContain('Available rule IDs:');
      expect(error?.message).toContain('builtin_string');
      expect(error?.message).toContain('builtin_email');
      expect(error?.message).toContain('builtin_required');
    });

    it('should work correctly with valid rule IDs', async () => {
      // Verify that valid rule IDs still work
      const result = await engine.validate('test@example.com', {
        rules: ['builtin_email', 'builtin_required'], // Valid rule IDs
      });

      // Should run the rules
      expect(result.totalChecks).toBeGreaterThan(0);
      expect(result.totalChecks).toBe(2); // Both rules should run
    });

    it('should work when no rules filter is provided', async () => {
      // Verify that omitting rules runs all builtin rules
      const result = await engine.validate('test@example.com');

      // Should run all builtin rules
      expect(result.totalChecks).toBeGreaterThan(2);
    });

    it('should handle empty rules array', async () => {
      // Empty rules array should run all builtin rules (no filter)
      const result = await engine.validate('test@example.com', {
        rules: [],
      });

      // Should run all builtin rules since filter is empty
      expect(result.totalChecks).toBeGreaterThan(2);
    });

    it('should provide helpful error for common mistakes', async () => {
      // Test common user errors:
      // - Using "email" instead of "builtin_email"
      // - Using "required" instead of "builtin_required"
      // - Using "non_empty" instead of "builtin_non_empty_string"
      const result = await engine.validate('test', {
        rules: ['email', 'required', 'non_empty'], // Common mistakes
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);

      const error = result.errors[0];
      // Error should clearly show the requested (wrong) IDs
      expect(error?.message).toContain('email');
      expect(error?.message).toContain('required');
      expect(error?.message).toContain('non_empty');
      // And show the correct builtin_ prefixed IDs
      expect(error?.message).toContain('builtin_');
    });

    it('should handle mixed valid and invalid rule IDs', async () => {
      // If some rules are valid and some aren't, should still validate with valid ones
      // But this is a bit tricky - current implementation filters, so if any match, those run
      const result = await engine.validate('test@example.com', {
        rules: ['builtin_email', 'invalid_rule'], // One valid, one invalid
      });

      // Should run the valid rule
      expect(result.totalChecks).toBe(1); // Only builtin_email should run
      expect(result.valid).toBe(true); // test@example.com passes email validation
    });
  });

  describe('regression tests', () => {
    it('should not break existing validation behavior', async () => {
      // Ensure the fix doesn't break existing functionality
      const result = await engine.validate('test@example.com', {
        rules: ['builtin_email'],
      });

      expect(result.valid).toBe(true);
      expect(result.totalChecks).toBe(1);
      expect(result.passedChecks).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle validation errors correctly', async () => {
      // Test that actual validation errors still work
      const result = await engine.validate('invalid-email', {
        rules: ['builtin_email'],
      });

      expect(result.valid).toBe(false);
      expect(result.totalChecks).toBe(1);
      expect(result.passedChecks).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('email');
    });
  });
});
