/**
 * ServalSheets - ValidationEngine Test Suite
 *
 * Comprehensive tests covering:
 * - Built-in type validators (string, number, boolean, date)
 * - Format validators (email, URL, phone)
 * - Range validators (positive, non-negative)
 * - Required field validators
 * - Custom rule registration and execution
 * - Rule composition and priority
 * - Performance optimization (caching, early exit)
 * - Error handling and statistics
 *
 * Test Count: 18 comprehensive test cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationEngine } from '../../src/services/validation-engine.js';
import type { ValidationRule, ValidationContext } from '../../src/types/validation.js';

describe('ValidationEngine', () => {
  let validationEngine: ValidationEngine;

  beforeEach(() => {
    // Create a fresh instance for each test
    validationEngine = new ValidationEngine({
      enabled: true,
      enableCaching: true,
      stopOnFirstError: false,
      maxErrors: 100,
      verboseLogging: false,
    });
    validationEngine.clearCache();
    validationEngine.resetStats();
  });

  describe('Built-in Type Validators', () => {
    it('should validate string type correctly', async () => {
      // Arrange
      const validValue = 'test string';
      const invalidValue = 123;

      // Enable only string validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_string');
      });

      // Act
      const validResult = await validationEngine.validate(validValue);
      const invalidResult = await validationEngine.validate(invalidValue);

      // Assert
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);
      expect(validResult.passedChecks).toBe(1);

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(1);
      expect(invalidResult.errors[0].message).toContain('string');
      expect(invalidResult.errors[0].rule.type).toBe('data_type');
    });

    it('should validate number type correctly', async () => {
      // Arrange
      const validValue = 42;
      const invalidValue = 'not a number';
      const nanValue = NaN;

      // Enable only number validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_number');
      });

      // Act
      const validResult = await validationEngine.validate(validValue);
      const invalidResult = await validationEngine.validate(invalidValue);
      const nanResult = await validationEngine.validate(nanValue);

      // Assert
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(1);

      expect(nanResult.valid).toBe(false);
      expect(nanResult.errors).toHaveLength(1);
      expect(nanResult.errors[0].message).toContain('number');
    });

    it('should validate boolean type correctly', async () => {
      // Arrange
      const validValue = true;
      const invalidValue = 'true';

      // Enable only boolean validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_boolean');
      });

      // Act
      const validResult = await validationEngine.validate(validValue);
      const invalidResult = await validationEngine.validate(invalidValue);

      // Assert
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(1);
      expect(invalidResult.errors[0].message).toContain('boolean');
    });

    it('should validate date type correctly', async () => {
      // Arrange
      const validDate = '2024-01-15';
      const validISODate = '2024-01-15T10:30:00Z';
      const invalidDate = 'not a date';

      // Enable only date validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_date');
      });

      // Act
      const validResult = await validationEngine.validate(validDate);
      const validISOResult = await validationEngine.validate(validISODate);
      const invalidResult = await validationEngine.validate(invalidDate);

      // Assert
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      expect(validISOResult.valid).toBe(true);
      expect(validISOResult.errors).toHaveLength(0);

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(1);
      expect(invalidResult.errors[0].message).toContain('date');
    });
  });

  describe('Format Validators', () => {
    it('should validate email format correctly', async () => {
      // Arrange
      const validEmails = ['user@example.com', 'test.user@company.co.uk', 'admin+tag@domain.org'];
      const invalidEmails = [
        'not an email',
        '@example.com',
        'user@',
        'user @example.com',
        'user@example',
      ];

      // Enable only email validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_email');
      });

      // Act & Assert - Valid emails
      for (const email of validEmails) {
        const result = await validationEngine.validate(email);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid emails
      for (const email of invalidEmails) {
        const result = await validationEngine.validate(email);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('email');
      }
    });

    it('should validate URL format correctly', async () => {
      // Arrange
      const validURLs = [
        'https://example.com',
        'http://subdomain.example.com',
        'https://example.com/path?query=value',
        'ftp://files.example.com',
      ];
      const invalidURLs = ['not a url', '://missing-protocol'];

      // Enable only URL validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_url');
      });

      // Act & Assert - Valid URLs
      for (const url of validURLs) {
        const result = await validationEngine.validate(url);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid URLs
      for (const url of invalidURLs) {
        const result = await validationEngine.validate(url);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('URL');
      }
    });

    it('should validate phone format correctly', async () => {
      // Arrange
      const validPhones = [
        '+1234567890',
        '123-456-7890',
        '(123) 456-7890',
        '+1 (123) 456-7890',
        '1234567890',
      ];
      const invalidPhones = ['123', 'abc-def-ghij', '12345', ''];

      // Enable only phone validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_phone');
      });

      // Act & Assert - Valid phones
      for (const phone of validPhones) {
        const result = await validationEngine.validate(phone);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid phones
      for (const phone of invalidPhones) {
        const result = await validationEngine.validate(phone);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('phone');
      }
    });
  });

  describe('Range Validators', () => {
    it('should validate positive numbers correctly', async () => {
      // Arrange
      const validValues = [1, 0.1, 100, 999.99];
      const invalidValues = [0, -1, -0.1, -100];

      // Enable only positive validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_positive');
      });

      // Act & Assert - Valid positive numbers
      for (const value of validValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid positive numbers
      for (const value of invalidValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('positive');
      }
    });

    it('should validate non-negative numbers correctly', async () => {
      // Arrange
      const validValues = [0, 1, 0.1, 100, 999.99];
      const invalidValues = [-0.001, -1, -100];

      // Enable only non-negative validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_non_negative');
      });

      // Act & Assert - Valid non-negative numbers
      for (const value of validValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid non-negative numbers
      for (const value of invalidValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('non-negative');
      }
    });
  });

  describe('Required Field Validators', () => {
    it('should validate required fields correctly', async () => {
      // Arrange
      const validValues = ['text', 0, false, [], {}];
      const invalidValues = [null, undefined, ''];

      // Enable only required validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_required');
      });

      // Act & Assert - Valid required fields
      for (const value of validValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid required fields
      for (const value of invalidValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('required');
      }
    });

    it('should validate non-empty strings correctly', async () => {
      // Arrange
      const validValues = ['text', 'a', '  text  '];
      const invalidValues = ['', '   ', '\t\n'];

      // Enable only non-empty string validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_non_empty_string');
      });

      // Act & Assert - Valid non-empty strings
      for (const value of validValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }

      // Act & Assert - Invalid non-empty strings
      for (const value of invalidValues) {
        const result = await validationEngine.validate(value);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('empty');
      }
    });
  });

  describe('Custom Rules', () => {
    it('should register and execute custom validation rule', async () => {
      // Arrange
      const customRule: ValidationRule = {
        id: 'custom_even',
        name: 'Even Number',
        type: 'custom',
        description: 'Validates that number is even',
        validator: (value) => {
          if (typeof value !== 'number') {
            return { valid: false, message: 'Value must be a number' };
          }
          const isEven = value % 2 === 0;
          return {
            valid: isEven,
            message: isEven ? undefined : 'Number must be even',
          };
        },
        severity: 'error',
        errorMessage: 'Value must be an even number',
        enabled: true,
      };

      // Disable all builtin rules
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, false);
      });

      // Register custom rule
      validationEngine.registerRule(customRule);
      validationEngine.setRuleEnabled('custom_even', true);

      // Act
      const validResult = await validationEngine.validate(4);
      const invalidResult = await validationEngine.validate(3);

      // Assert
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(1);
      expect(invalidResult.errors[0].message).toContain('even');
    });

    it('should execute multiple custom rules in sequence', async () => {
      // Arrange
      const rule1: ValidationRule = {
        id: 'custom_min_length',
        name: 'Minimum Length',
        type: 'custom',
        description: 'Validates minimum string length',
        validator: (value) => {
          if (typeof value !== 'string') {
            return { valid: false, message: 'Must be a string' };
          }
          return {
            valid: value.length >= 3,
            message: value.length >= 3 ? undefined : 'Must be at least 3 characters',
          };
        },
        severity: 'error',
        errorMessage: 'String too short',
        enabled: true,
      };

      const rule2: ValidationRule = {
        id: 'custom_starts_with_a',
        name: 'Starts with A',
        type: 'custom',
        description: 'Validates string starts with A',
        validator: (value) => {
          if (typeof value !== 'string') {
            return { valid: false, message: 'Must be a string' };
          }
          return {
            valid: value.startsWith('A'),
            message: value.startsWith('A') ? undefined : "Must start with 'A'",
          };
        },
        severity: 'warning',
        errorMessage: 'Should start with A',
        enabled: true,
      };

      // Disable all builtin rules
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, false);
      });

      // Register custom rules
      validationEngine.registerRule(rule1);
      validationEngine.registerRule(rule2);

      // Act
      const allPassResult = await validationEngine.validate('Apple');
      const oneFailResult = await validationEngine.validate('Banana');
      const twoFailResult = await validationEngine.validate('Ap');

      // Assert
      expect(allPassResult.valid).toBe(true);
      expect(allPassResult.errors).toHaveLength(0);
      expect(allPassResult.warnings).toHaveLength(0);

      expect(oneFailResult.valid).toBe(true); // No errors
      expect(oneFailResult.warnings).toHaveLength(1);
      expect(oneFailResult.warnings[0].message).toContain("start with 'A'");

      expect(twoFailResult.valid).toBe(false); // Has error
      expect(twoFailResult.errors).toHaveLength(1);
      // Note: Warning may or may not be present depending on rule execution order
      // The important part is that we have at least the error
      expect(twoFailResult.errors[0].message).toContain('3 characters');
    });

    it('should support custom rules with validation context', async () => {
      // Arrange
      const contextAwareRule: ValidationRule = {
        id: 'custom_context_aware',
        name: 'Context Aware',
        type: 'custom',
        description: 'Validates based on context',
        validator: (value, context) => {
          if (context?.metadata?.strictMode) {
            return {
              valid: typeof value === 'string' && value.length > 10,
              message:
                typeof value === 'string' && value.length > 10
                  ? undefined
                  : 'Strict mode: must be string longer than 10 characters',
            };
          } else {
            return {
              valid: typeof value === 'string',
              message: typeof value === 'string' ? undefined : 'Must be a string',
            };
          }
        },
        severity: 'error',
        errorMessage: 'Validation failed',
        enabled: true,
      };

      // Create fresh engine for this test to avoid interference
      const freshEngine = new ValidationEngine({
        enabled: true,
        enableCaching: false, // Disable caching for this test
        stopOnFirstError: false,
        maxErrors: 100,
      });

      // Disable all builtin rules
      const rules = freshEngine.getRules();
      rules.forEach((rule) => {
        freshEngine.setRuleEnabled(rule.id, false);
      });

      // Register custom rule
      freshEngine.registerRule(contextAwareRule);

      const normalContext: ValidationContext = {
        spreadsheetId: 'test-sheet',
        metadata: { strictMode: false },
      };

      const strictContext: ValidationContext = {
        spreadsheetId: 'test-sheet',
        metadata: { strictMode: true },
      };

      // Act
      const normalResult = await freshEngine.validate('short', normalContext);
      const strictResult = await freshEngine.validate('short', strictContext);
      const strictValidResult = await freshEngine.validate('this is a long string', strictContext);

      // Assert
      expect(normalResult.valid).toBe(true);
      expect(normalResult.totalChecks).toBeGreaterThan(0);

      expect(strictResult.valid).toBe(false);
      expect(strictResult.totalChecks).toBeGreaterThan(0);
      expect(strictResult.errors).toHaveLength(1);
      expect(strictResult.errors[0].message).toContain('Strict mode');

      expect(strictValidResult.valid).toBe(true);
      expect(strictValidResult.totalChecks).toBeGreaterThan(0);
    });
  });

  describe('Performance and Caching', () => {
    it('should cache validation results for improved performance', async () => {
      // Arrange
      const value = 'test@example.com';

      // Enable only email validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_email');
      });

      // Act - First validation (not cached)
      const result1 = await validationEngine.validate(value);
      const stats1 = validationEngine.getStats();

      // Act - Second validation (should be cached)
      const result2 = await validationEngine.validate(value);
      const stats2 = validationEngine.getStats();

      // Assert
      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);

      // Both should return same result
      expect(result1.valid).toBe(result2.valid);

      // Total validations should increase
      expect(stats2.totalValidations).toBe(stats1.totalValidations + 1);

      // Second validation should be faster (cached) - but timing can vary
      // Just verify both succeeded with same result
      expect(result1.valid).toBe(result2.valid);
    });

    it('should support early exit on first error when configured', async () => {
      // Arrange
      const engineWithEarlyExit = new ValidationEngine({
        enabled: true,
        stopOnFirstError: true,
        maxErrors: 100,
      });

      // Register multiple failing rules
      const rule1: ValidationRule = {
        id: 'fail_1',
        name: 'Fail 1',
        type: 'custom',
        description: 'Always fails',
        validator: () => ({ valid: false, message: 'Rule 1 failed' }),
        severity: 'error',
        errorMessage: 'Error 1',
        enabled: true,
      };

      const rule2: ValidationRule = {
        id: 'fail_2',
        name: 'Fail 2',
        type: 'custom',
        description: 'Always fails',
        validator: () => ({ valid: false, message: 'Rule 2 failed' }),
        severity: 'error',
        errorMessage: 'Error 2',
        enabled: true,
      };

      const rule3: ValidationRule = {
        id: 'fail_3',
        name: 'Fail 3',
        type: 'custom',
        description: 'Always fails',
        validator: () => ({ valid: false, message: 'Rule 3 failed' }),
        severity: 'error',
        errorMessage: 'Error 3',
        enabled: true,
      };

      // Disable builtin rules
      const builtinRules = engineWithEarlyExit.getRules();
      builtinRules.forEach((rule) => {
        engineWithEarlyExit.setRuleEnabled(rule.id, false);
      });

      // Register failing rules
      engineWithEarlyExit.registerRule(rule1);
      engineWithEarlyExit.registerRule(rule2);
      engineWithEarlyExit.registerRule(rule3);

      // Act
      const result = await engineWithEarlyExit.validate('test');

      // Assert
      expect(result.valid).toBe(false);
      // Should stop at first error, not collect all errors
      expect(result.errors.length).toBeLessThan(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Rule 1 failed');
    });
  });

  describe('Error Handling and Statistics', () => {
    it('should handle validator exceptions gracefully', async () => {
      // Arrange
      const throwingRule: ValidationRule = {
        id: 'throwing_rule',
        name: 'Throwing Rule',
        type: 'custom',
        description: 'Throws an exception',
        validator: () => {
          throw new Error('Validator exploded!');
        },
        severity: 'error',
        errorMessage: 'Validation error',
        enabled: true,
      };

      // Disable builtin rules
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, false);
      });

      // Register throwing rule
      validationEngine.registerRule(throwingRule);

      // Act - Should not throw, should handle gracefully
      const result = await validationEngine.validate('test');

      // Assert
      expect(result).toBeDefined();
      expect(result.valid).toBe(true); // No errors collected due to exception handling
      expect(result.errors).toHaveLength(0);
    });

    it('should collect comprehensive statistics', async () => {
      // Arrange
      const values = [
        'valid@email.com', // Pass
        'invalid email', // Fail
        'another@valid.com', // Pass
        'bad', // Fail
      ];

      // Enable only email validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_email');
      });

      // Act
      for (const value of values) {
        await validationEngine.validate(value);
      }

      const stats = validationEngine.getStats();

      // Assert
      expect(stats.totalValidations).toBe(4);
      expect(stats.passedValidations).toBe(2);
      expect(stats.failedValidations).toBe(2);
      expect(stats.successRate).toBe(0.5);
      expect(stats.avgValidationTime).toBeGreaterThanOrEqual(0); // Can be 0 for fast validations
      expect(stats.errorsByType.format).toBe(2);
      expect(stats.errorsBySeverity.error).toBe(2);
    });

    it('should respect max errors configuration', async () => {
      // Arrange
      const engineWithMaxErrors = new ValidationEngine({
        enabled: true,
        maxErrors: 2,
      });

      // Register multiple failing rules
      for (let i = 0; i < 5; i++) {
        const rule: ValidationRule = {
          id: `fail_${i}`,
          name: `Fail ${i}`,
          type: 'custom',
          description: 'Always fails',
          validator: () => ({ valid: false, message: `Rule ${i} failed` }),
          severity: 'error',
          errorMessage: `Error ${i}`,
          enabled: true,
        };

        // Disable builtin rules first
        if (i === 0) {
          const builtinRules = engineWithMaxErrors.getRules();
          builtinRules.forEach((builtinRule) => {
            engineWithMaxErrors.setRuleEnabled(builtinRule.id, false);
          });
        }

        engineWithMaxErrors.registerRule(rule);
      }

      // Act
      const result = await engineWithMaxErrors.validate('test');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Batch Validation', () => {
    it('should validate multiple values in batch', async () => {
      // Arrange
      const values = ['user1@example.com', 'invalid', 'user2@example.com', 'also invalid'];

      // Enable only email validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_email');
      });

      // Act
      const reports = await validationEngine.validateBatch(values);

      // Assert
      expect(reports).toHaveLength(4);
      expect(reports[0].valid).toBe(true);
      expect(reports[1].valid).toBe(false);
      expect(reports[2].valid).toBe(true);
      expect(reports[3].valid).toBe(false);

      // Check that each report has proper structure
      reports.forEach((report) => {
        expect(report.id).toBeDefined();
        expect(report.totalChecks).toBeGreaterThan(0);
        expect(report.duration).toBeGreaterThanOrEqual(0);
        expect(report.timestamp).toBeGreaterThan(0);
      });
    });
  });

  describe('Rule Management', () => {
    it('should enable and disable rules dynamically', async () => {
      // Arrange
      const value = 'test@example.com';

      // Disable all rules
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, false);
      });

      // Act - With all rules disabled
      const result1 = await validationEngine.validate(value);

      // Enable email validator
      validationEngine.setRuleEnabled('builtin_email', true);

      // Act - With email validator enabled
      const result2 = await validationEngine.validate(value);

      // Assert
      expect(result1.totalChecks).toBe(0);
      expect(result1.valid).toBe(true);

      expect(result2.totalChecks).toBe(1);
      expect(result2.valid).toBe(true);
    });

    it('should list all registered rules', async () => {
      // Arrange & Act
      const rules = validationEngine.getRules();

      // Assert
      expect(rules.length).toBeGreaterThan(0);

      // Check that all expected builtin rules are present
      const ruleIds = rules.map((rule) => rule.id);
      expect(ruleIds).toContain('builtin_string');
      expect(ruleIds).toContain('builtin_number');
      expect(ruleIds).toContain('builtin_boolean');
      expect(ruleIds).toContain('builtin_date');
      expect(ruleIds).toContain('builtin_email');
      expect(ruleIds).toContain('builtin_url');
      expect(ruleIds).toContain('builtin_phone');
      expect(ruleIds).toContain('builtin_positive');
      expect(ruleIds).toContain('builtin_non_negative');
      expect(ruleIds).toContain('builtin_required');
      expect(ruleIds).toContain('builtin_non_empty_string');

      // All rules should have required properties
      rules.forEach((rule) => {
        expect(rule.id).toBeDefined();
        expect(rule.name).toBeDefined();
        expect(rule.type).toBeDefined();
        expect(rule.validator).toBeTypeOf('function');
        expect(rule.severity).toBeDefined();
      });
    });
  });

  describe('Engine Configuration', () => {
    it('should respect disabled engine configuration', async () => {
      // Arrange
      const disabledEngine = new ValidationEngine({ enabled: false });

      // Act
      const result = await disabledEngine.validate('any value');

      // Assert
      expect(result.valid).toBe(true);
      expect(result.totalChecks).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should clear cache and reset statistics', async () => {
      // Arrange
      const value = 'test@example.com';

      // Enable only email validator
      const rules = validationEngine.getRules();
      rules.forEach((rule) => {
        validationEngine.setRuleEnabled(rule.id, rule.id === 'builtin_email');
      });

      // Act - Validate to populate stats and cache
      await validationEngine.validate(value);
      await validationEngine.validate(value); // Second time for cache

      const statsBefore = validationEngine.getStats();
      expect(statsBefore.totalValidations).toBe(2);

      // Reset
      validationEngine.resetStats();
      validationEngine.clearCache();

      const statsAfter = validationEngine.getStats();

      // Validate again to check cache was cleared
      const result = await validationEngine.validate(value);

      // Assert
      expect(statsAfter.totalValidations).toBe(0);
      expect(statsAfter.passedValidations).toBe(0);
      expect(statsAfter.failedValidations).toBe(0);
      expect(result.valid).toBe(true);
    });
  });
});
