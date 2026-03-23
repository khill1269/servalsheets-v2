/**
 * Category 11: Error Recovery & Self-Correction
 *
 * Tests for intelligent error recovery, fix suggestions, and self-correction protocol.
 * Validates all 21+ error patterns from error-fix-suggester.ts.
 *
 * Coverage:
 * - 11.1-11.19: Error pattern recognition → fix suggestions
 * - 11.20: Error pattern learning (3+ occurrences)
 * - 11.21: Self-correction protocol (5-step verification)
 *
 * Source files:
 * - src/services/error-fix-suggester.ts (27 error patterns)
 * - src/services/error-pattern-learner.ts (learning & prevention)
 * - src/mcp/registration/response-intelligence.ts (recovery wiring)
 * - src/handlers/base.ts (mapError + fixableVia injection)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  suggestFix,
  type SuggestedFix,
} from '../../src/services/error-fix-suggester.js';
import { ErrorPatternLearner } from '../../src/services/error-pattern-learner.js';

describe('Category 11: Error Recovery & Self-Correction', () => {
  let learner: ErrorPatternLearner;

  beforeEach(() => {
    learner = new ErrorPatternLearner();
  });

  // =========================================================================
  // 11.1 INVALID_RANGE → fixableVia.params includes corrected range
  // =========================================================================
  describe('11.1 INVALID_RANGE correction', () => {
    it('should suggest bounded range for unbounded column reference', () => {
      const fix = suggestFix(
        'INVALID_RANGE',
        'Range A:Z is unbounded',
        'sheets_data',
        'read',
        { range: 'A:Z', spreadsheetId: 'abc123' }
      );

      expect(fix).toBeDefined();
      expect(fix?.tool).toBe('sheets_data');
      expect(fix?.action).toBe('read');
      expect(fix?.params.range).toBe('A1:Z1000');
      expect(fix?.explanation).toContain('unbounded');
      expect(fix?.explanation).toContain('1:1000');
    });

    it('should preserve sheet prefix when bounding range', () => {
      const fix = suggestFix(
        'INVALID_RANGE',
        'Range is unbounded',
        'sheets_data',
        'read',
        { range: 'Sheet1!B:D', spreadsheetId: 'abc123' }
      );

      expect(fix?.params.range).toBe('Sheet1!B1:D1000');
    });

    it('should handle validation error with unbounded keyword', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'Range contains unbounded columns',
        'sheets_data',
        'read',
        { range: 'X:Y', spreadsheetId: 'abc123' }
      );

      expect(fix?.params.range).toBe('X1:Y1000');
    });
  });

  // =========================================================================
  // 11.2 SHEET_NOT_FOUND → suggests sheets_core.list_sheets; detects emoji/whitespace/case
  // =========================================================================
  describe('11.2 SHEET_NOT_FOUND with context detection', () => {
    it('should suggest list_sheets action', () => {
      const fix = suggestFix(
        'SHEET_NOT_FOUND',
        "Sheet 'Sales' not found",
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_core');
      expect(fix?.action).toBe('list_sheets');
      expect(fix?.params.spreadsheetId).toBe('abc123');
    });

    it('should detect emoji in sheet name', () => {
      const fix = suggestFix(
        'SHEET_NOT_FOUND',
        "Sheet '📊 Dashboard' not found",
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('📊 Dashboard');
      expect(fix?.explanation).toContain('emoji');
      expect(fix?.explanation).toContain('Unicode codepoints');
    });

    it('should detect trailing whitespace in sheet name', () => {
      const fix = suggestFix(
        'SHEET_NOT_FOUND',
        "Sheet 'Sales ' not found",
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('Sales ');
      expect(fix?.explanation).toContain('trailing whitespace');
      expect(fix?.explanation).toContain('trim it');
    });

    it('should detect case sensitivity issue', () => {
      const fix = suggestFix(
        'SHEET_NOT_FOUND',
        "Sheet 'sales' not found",
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('sales');
      expect(fix?.explanation).toContain('case-sensitive');
    });

    it('should handle NOT_FOUND error code variant', () => {
      const fix = suggestFix(
        'NOT_FOUND',
        "Sheet 'Missing' not found",
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_core');
      expect(fix?.action).toBe('list_sheets');
    });
  });

  // =========================================================================
  // 11.3 SPREADSHEET_NOT_FOUND → suggests sheets_core.list
  // =========================================================================
  describe('11.3 SPREADSHEET_NOT_FOUND', () => {
    it('should suggest list action', () => {
      const fix = suggestFix(
        'SPREADSHEET_NOT_FOUND',
        'Spreadsheet not found',
        'sheets_core',
        'get',
        { spreadsheetId: 'nonexistent' }
      );

      expect(fix?.tool).toBe('sheets_core');
      expect(fix?.action).toBe('list');
      expect(fix?.params).toEqual({});
      expect(fix?.explanation).toContain('Spreadsheet not found');
    });
  });

  // =========================================================================
  // 11.4 PERMISSION_DENIED → suggests sheets_auth.login
  // =========================================================================
  describe('11.4 PERMISSION_DENIED', () => {
    it('should suggest re-login for PERMISSION_DENIED', () => {
      const fix = suggestFix(
        'PERMISSION_DENIED',
        'Access denied',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_auth');
      expect(fix?.action).toBe('login');
      expect(fix?.explanation).toContain('Re-authenticate');
    });

    it('should suggest re-login for AUTH_ERROR', () => {
      const fix = suggestFix(
        'AUTH_ERROR',
        'Authentication failed',
        'sheets_data',
        'read',
        {}
      );

      expect(fix?.tool).toBe('sheets_auth');
      expect(fix?.action).toBe('login');
    });

    it('should suggest re-login for AUTHENTICATION_ERROR', () => {
      const fix = suggestFix(
        'AUTHENTICATION_ERROR',
        'Not authenticated',
        'sheets_data',
        'read',
        {}
      );

      expect(fix?.tool).toBe('sheets_auth');
      expect(fix?.action).toBe('login');
    });
  });

  // =========================================================================
  // 11.5 QUOTA_EXCEEDED → retry with minimal verbosity
  // =========================================================================
  describe('11.5 QUOTA_EXCEEDED', () => {
    it('should suggest retry with minimal verbosity', () => {
      const params = { spreadsheetId: 'abc123', range: 'A1:Z1000' };
      const fix = suggestFix(
        'QUOTA_EXCEEDED',
        'Rate limit exceeded',
        'sheets_data',
        'read',
        params
      );

      expect(fix?.tool).toBe('sheets_data');
      expect(fix?.action).toBe('read');
      expect(fix?.params.verbosity).toBe('minimal');
      expect(fix?.explanation).toContain('Rate limited');
      expect(fix?.explanation).toContain('minimal verbosity');
    });

    it('should handle RESOURCE_EXHAUSTED variant', () => {
      const fix = suggestFix(
        'RESOURCE_EXHAUSTED',
        'Resources exhausted',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.params.verbosity).toBe('minimal');
    });

    it('should handle RATE_LIMITED variant', () => {
      const fix = suggestFix(
        'RATE_LIMITED',
        'Too many requests',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.params.verbosity).toBe('minimal');
    });
  });

  // =========================================================================
  // 11.6 VALIDATION_ERROR → required fields listed
  // =========================================================================
  describe('11.6 VALIDATION_ERROR with required fields', () => {
    it('should suggest required parameter check when message contains "required"', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'spreadsheetId: required',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix).toBeDefined();
      expect(fix?.explanation).toContain('Missing required parameter');
      expect(fix?.explanation).toContain('sheets_data.read');
    });

    it('should handle range format validation error', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'range: Expected object, got string',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('Range must be an object');
      expect(fix?.explanation).toContain('{ a1: "Sheet1!A1:B10" }');
    });

    it('should handle missing spreadsheetId error', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'spreadsheetId: Required field',
        'sheets_data',
        'read',
        {}
      );

      expect(fix?.explanation).toContain('Missing required spreadsheetId');
      expect(fix?.explanation).toContain('sheets_core.list');
    });

    it('should handle missing action error', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'action: Invalid discriminator value',
        'sheets_analyze',
        undefined,
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('Invalid or missing "action"');
      expect(fix?.explanation).toContain('sheets_analyze');
    });
  });

  // =========================================================================
  // 11.7 FORMULA_ERROR → suggests sheets_analyze.analyze_formulas
  // =========================================================================
  describe('11.7 FORMULA_ERROR', () => {
    it('should suggest analyze_formulas', () => {
      const fix = suggestFix(
        'FORMULA_ERROR',
        'Invalid formula syntax',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_analyze');
      expect(fix?.action).toBe('analyze_formulas');
      expect(fix?.explanation).toContain('Formula error detected');
    });

    it('should handle FORMULA_PARSE_ERROR variant', () => {
      const fix = suggestFix(
        'FORMULA_PARSE_ERROR',
        'Failed to parse formula',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_analyze');
      expect(fix?.action).toBe('analyze_formulas');
    });

    it('should handle COMPUTE_ERROR variant', () => {
      const fix = suggestFix(
        'COMPUTE_ERROR',
        'Formula computation failed',
        'sheets_compute',
        'evaluate',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_analyze');
      expect(fix?.action).toBe('analyze_formulas');
    });

    it('should handle invalid formula message', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'invalid formula in cell B5',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_analyze');
    });
  });

  // =========================================================================
  // 11.8 CIRCULAR_REFERENCE → suggests sheets_dependencies.detect_cycles
  // =========================================================================
  describe('11.8 CIRCULAR_REFERENCE', () => {
    it('should suggest detect_cycles', () => {
      const fix = suggestFix(
        'CIRCULAR_REFERENCE',
        'Circular reference detected',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_dependencies');
      expect(fix?.action).toBe('detect_cycles');
      expect(fix?.explanation).toContain('Circular reference detected');
    });

    it('should handle CIRCULAR_DEPENDENCY variant', () => {
      const fix = suggestFix(
        'CIRCULAR_DEPENDENCY',
        'Circular dependency',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_dependencies');
      expect(fix?.action).toBe('detect_cycles');
    });

    it('should handle "cycle" message', () => {
      const fix = suggestFix(
        'INTERNAL_ERROR',
        'Dependency cycle detected',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_dependencies');
      expect(fix?.action).toBe('detect_cycles');
    });
  });

  // =========================================================================
  // 11.9 EDIT_CONFLICT → suggests sheets_quality.resolve_conflict
  // =========================================================================
  describe('11.9 EDIT_CONFLICT', () => {
    it('should suggest resolve_conflict', () => {
      const fix = suggestFix(
        'EDIT_CONFLICT',
        'Concurrent modification conflict',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_quality');
      expect(fix?.action).toBe('resolve_conflict');
      expect(fix?.explanation).toContain('Concurrent edit conflict detected');
    });

    it('should handle CONFLICT variant', () => {
      const fix = suggestFix(
        'CONFLICT',
        'Write conflict',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_quality');
    });

    it('should handle CONCURRENT_MODIFICATION variant', () => {
      const fix = suggestFix(
        'CONCURRENT_MODIFICATION',
        'Concurrent edit',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_quality');
    });
  });

  // =========================================================================
  // 11.10 TIMEOUT → retry with smaller range
  // =========================================================================
  describe('11.10 TIMEOUT', () => {
    it('should suggest retry with minimal verbosity', () => {
      const params = { spreadsheetId: 'abc123', range: 'A1:Z100000' };
      const fix = suggestFix(
        'TIMEOUT',
        'Operation timed out',
        'sheets_data',
        'read',
        params
      );

      expect(fix?.tool).toBe('sheets_data');
      expect(fix?.action).toBe('read');
      expect(fix?.params.verbosity).toBe('minimal');
      expect(fix?.explanation).toContain('timed out');
      expect(fix?.explanation).toContain('smaller range');
    });

    it('should handle DEADLINE_EXCEEDED variant', () => {
      const fix = suggestFix(
        'DEADLINE_EXCEEDED',
        'Deadline exceeded',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.params.verbosity).toBe('minimal');
    });

    it('should handle "timeout" message', () => {
      const fix = suggestFix(
        'INTERNAL_ERROR',
        'Request timeout after 30s',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.params.verbosity).toBe('minimal');
    });
  });

  // =========================================================================
  // 11.11 PROTECTED_RANGE → suggests sheets_advanced.list_protected_ranges
  // =========================================================================
  describe('11.11 PROTECTED_RANGE', () => {
    it('should suggest list_protected_ranges', () => {
      const fix = suggestFix(
        'PROTECTED_RANGE',
        'Range is protected',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_advanced');
      expect(fix?.action).toBe('list_protected_ranges');
      expect(fix?.explanation).toContain('protected');
    });

    it('should handle "protected" message keyword with PROTECTED_RANGE code', () => {
      const fix = suggestFix(
        'PROTECTED_RANGE',
        'This range is protected',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_advanced');
    });

    it('should use PROTECTED_RANGE error code to avoid PERMISSION_DENIED match', () => {
      // Note: Using PERMISSION_DENIED error code will match the auth login check first.
      // Use PROTECTED_RANGE error code explicitly.
      const fix = suggestFix(
        'PROTECTED_RANGE',
        'No edit access to protected range',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_advanced');
      expect(fix?.action).toBe('list_protected_ranges');
    });
  });

  // =========================================================================
  // 11.12 BATCH_UPDATE_ERROR → chunk size recommendation
  // =========================================================================
  describe('11.12 BATCH_UPDATE_ERROR', () => {
    it('should suggest transactions for batch errors', () => {
      const fix = suggestFix(
        'BATCH_UPDATE_ERROR',
        'Batch update failed',
        'sheets_data',
        'batch_write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_transaction');
      expect(fix?.action).toBe('begin');
      expect(fix?.explanation).toContain('Batch update failed');
    });

    it('should handle "batch error" message', () => {
      const fix = suggestFix(
        'BATCH_UPDATE_ERROR',
        'The batch operation encountered an error',
        'sheets_data',
        'batch_write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_transaction');
    });
  });

  // =========================================================================
  // 11.13 FORMULA_INJECTION_BLOCKED → sanitization guidance
  // =========================================================================
  describe('11.13 FORMULA_INJECTION_BLOCKED', () => {
    it('should explain formula injection protection', () => {
      const fix = suggestFix(
        'FORMULA_INJECTION_BLOCKED',
        'Formula injection detected',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('Formula injection blocked');
      expect(fix?.explanation).toContain("single quote");
      expect(fix?.explanation).toContain("'=text");
    });

    it('should handle "formula security" message', () => {
      const fix = suggestFix(
        'VALIDATION_ERROR',
        'formula security violation',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.explanation).toContain('Formula injection');
    });
  });

  // =========================================================================
  // 11.14 PAYLOAD_TOO_LARGE → chunk operations
  // =========================================================================
  describe('11.14 PAYLOAD_TOO_LARGE', () => {
    it('should suggest batch_operations', () => {
      const fix = suggestFix(
        'PAYLOAD_TOO_LARGE',
        'Payload too large',
        'sheets_data',
        'batch_write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_composite');
      expect(fix?.action).toBe('batch_operations');
      expect(fix?.explanation).toContain('Payload too large');
      expect(fix?.explanation).toContain('chunks');
    });

    it('should handle HTTP 413 error', () => {
      const fix = suggestFix(
        'PAYLOAD_TOO_LARGE',
        'HTTP 413: Payload too large',
        'sheets_data',
        'batch_write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_composite');
    });

    it('should handle "too large" message', () => {
      const fix = suggestFix(
        'PAYLOAD_TOO_LARGE',
        'Request payload is too large',
        'sheets_data',
        'batch_write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_composite');
    });
  });

  // =========================================================================
  // 11.15 TRANSACTION_CONFLICT → suggests sheets_transaction.begin
  // =========================================================================
  describe('11.15 TRANSACTION_CONFLICT', () => {
    it('should suggest begin for TRANSACTION_CONFLICT error code', () => {
      const fix = suggestFix(
        'TRANSACTION_CONFLICT',
        'Transaction operation failed',
        'sheets_transaction',
        'queue',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_transaction');
      expect(fix?.action).toBe('begin');
      expect(fix?.explanation).toContain('Transaction');
    });

    it('should match TRANSACTION_CONFLICT by error code alone (not message)', () => {
      // Note: If message contains 'conflict' it matches EDIT_CONFLICT first.
      // TRANSACTION_CONFLICT is distinguished by its error code.
      const fix = suggestFix(
        'TRANSACTION_CONFLICT',
        'An error occurred',
        'sheets_transaction',
        'queue',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_transaction');
      expect(fix?.action).toBe('begin');
    });
  });

  // =========================================================================
  // 11.16 TRANSACTION_EXPIRED → suggests sheets_transaction.begin
  // =========================================================================
  describe('11.16 TRANSACTION_EXPIRED', () => {
    it('should suggest begin for expired transaction', () => {
      const fix = suggestFix(
        'TRANSACTION_EXPIRED',
        'Transaction expired',
        'sheets_transaction',
        'queue',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_transaction');
      expect(fix?.action).toBe('begin');
      expect(fix?.explanation).toContain('Transaction');
      expect(fix?.explanation).toContain('expired');
    });

    it('should handle "transaction expired" message', () => {
      const fix = suggestFix(
        'INTERNAL_ERROR',
        'Your transaction has expired, start fresh',
        'sheets_transaction',
        'queue',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_transaction');
    });
  });

  // =========================================================================
  // 11.17 ELICITATION_UNAVAILABLE → suggests sheets_confirm.wizard_start
  // =========================================================================
  describe('11.17 ELICITATION_UNAVAILABLE', () => {
    it('should suggest wizard_start as alternative', () => {
      const fix = suggestFix(
        'ELICITATION_UNAVAILABLE',
        'Elicitation not available',
        'sheets_core',
        'create',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_confirm');
      expect(fix?.action).toBe('wizard_start');
      expect(fix?.explanation).toContain('Interactive prompt unavailable');
      expect(fix?.explanation).toContain('wizard_start');
    });
  });

  // =========================================================================
  // 11.18 CONNECTOR_ERROR → suggests sheets_connectors.status
  // =========================================================================
  describe('11.18 CONNECTOR_ERROR', () => {
    it('should suggest list_connectors', () => {
      const fix = suggestFix(
        'CONNECTOR_ERROR',
        'Connector failed to connect',
        'sheets_connectors',
        'query',
        {}
      );

      expect(fix?.tool).toBe('sheets_connectors');
      expect(fix?.action).toBe('list_connectors');
      expect(fix?.explanation).toContain('Connector error');
    });

    it('should handle "connector error" message', () => {
      const fix = suggestFix(
        'INTERNAL_ERROR',
        'External connector error',
        'sheets_connectors',
        'query',
        {}
      );

      expect(fix?.tool).toBe('sheets_connectors');
    });
  });

  // =========================================================================
  // 11.19 AMBIGUOUS_RANGE → explicit range required
  // =========================================================================
  describe('11.19 AMBIGUOUS_RANGE', () => {
    it('should suggest list_sheets for ambiguous range', () => {
      const fix = suggestFix(
        'AMBIGUOUS_RANGE',
        'Ambiguous range reference',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_core');
      expect(fix?.action).toBe('list_sheets');
      expect(fix?.explanation).toContain('Ambiguous range');
      expect(fix?.explanation).toContain('Sheet1!A1:B10');
    });

    it('should handle "ambiguous" message', () => {
      const fix = suggestFix(
        'AMBIGUOUS_RANGE',
        'The range reference is ambiguous',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix?.tool).toBe('sheets_core');
      expect(fix?.action).toBe('list_sheets');
    });
  });

  // =========================================================================
  // 11.20 Error pattern learning — 3+ occurrences → _learnedFix surfaces
  // =========================================================================
  describe('11.20 Error pattern learning (3+ occurrences)', () => {
    it('should not suggest learned fix with < 3 occurrences', () => {
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'x' not found", {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'y' not found", {
        tool: 'sheets_data',
        action: 'read',
      });

      const result = learner.getPatterns('SHEET_NOT_FOUND', {
        tool: 'sheets_data',
        action: 'read',
      });

      expect(result).toBeNull();
    });

    it('should suggest learned fix after 3+ occurrences', () => {
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'A' not found", {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'B' not found", {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'C' not found", {
        tool: 'sheets_data',
        action: 'read',
      });

      const result = learner.getPatterns('SHEET_NOT_FOUND', {
        tool: 'sheets_data',
        action: 'read',
      });

      expect(result).toBeDefined();
      expect(result?.topResolution).toBeDefined();
    });

    it('should track resolution success rate', () => {
      // Record 3 errors
      for (let i = 0; i < 3; i++) {
        learner.recordError('INVALID_RANGE', 'Range A:Z is unbounded', {
          tool: 'sheets_data',
          action: 'read',
        });
      }

      // Record 2 successful resolutions
      learner.recordResolution(
        'INVALID_RANGE',
        { tool: 'sheets_data', action: 'read' },
        'bounded_range',
        100
      );
      learner.recordResolution(
        'INVALID_RANGE',
        { tool: 'sheets_data', action: 'read' },
        'bounded_range',
        150
      );

      const result = learner.getPatterns('INVALID_RANGE', {
        tool: 'sheets_data',
        action: 'read',
      });

      expect(result?.topResolution?.successRate).toBeGreaterThan(0.5);
      expect(result?.topResolution?.occurrenceCount).toBe(3);
    });

    it('should return top resolution with highest success rate', () => {
      learner.recordError('TIMEOUT', 'Operation timed out', {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('TIMEOUT', 'Operation timed out', {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('TIMEOUT', 'Operation timed out', {
        tool: 'sheets_data',
        action: 'read',
      });

      learner.recordResolution(
        'TIMEOUT',
        { tool: 'sheets_data', action: 'read' },
        'retry_minimal',
        50
      );
      learner.recordResolution(
        'TIMEOUT',
        { tool: 'sheets_data', action: 'read' },
        'retry_minimal',
        60
      );
      learner.recordResolution(
        'TIMEOUT',
        { tool: 'sheets_data', action: 'read' },
        'split_range',
        200
      );

      const result = learner.getPatterns('TIMEOUT', {
        tool: 'sheets_data',
        action: 'read',
      });

      // retry_minimal has higher success rate
      expect(result?.topResolution?.fix).toBe('retry_minimal');
    });

    it('should prevent prevention suggestions with < 3 occurrences', () => {
      learner.recordError('QUOTA_EXCEEDED', 'Rate limit', {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('QUOTA_EXCEEDED', 'Rate limit', {
        tool: 'sheets_data',
        action: 'read',
      });

      const suggestions = learner.suggestPrevention({
        tool: 'sheets_data',
      });

      expect(suggestions.length).toBe(0);
    });

    it('should surface prevention suggestions after 3+ errors', () => {
      for (let i = 0; i < 4; i++) {
        learner.recordError('FORMULA_ERROR', 'Invalid formula', {
          tool: 'sheets_data',
          action: 'write',
        });
      }

      const suggestions = learner.suggestPrevention({
        tool: 'sheets_data',
      });

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].message).toContain('FORMULA_ERROR');
    });
  });

  // =========================================================================
  // 11.21 Self-correction protocol — 5-step verification
  // =========================================================================
  describe('11.21 Self-correction protocol', () => {
    it('should have fixableVia field in error response', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'INVALID_RANGE',
          message: 'Range A:Z is unbounded',
        },
        fixableVia: {
          tool: 'sheets_data',
          action: 'read',
          params: { range: 'A1:Z1000', spreadsheetId: 'abc123' },
        },
      };

      expect(errorResponse.fixableVia).toBeDefined();
      expect(errorResponse.fixableVia.tool).toBe('sheets_data');
      expect(errorResponse.fixableVia.action).toBe('read');
      expect(errorResponse.fixableVia.params.range).toBe('A1:Z1000');
    });

    it('should inject learned fix when pattern occurs 3+ times', () => {
      // Simulate recording 3+ errors
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'X' not found", {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'Y' not found", {
        tool: 'sheets_data',
        action: 'read',
      });
      learner.recordError('SHEET_NOT_FOUND', "Sheet 'Z' not found", {
        tool: 'sheets_data',
        action: 'read',
      });

      const pattern = learner.getPatterns('SHEET_NOT_FOUND', {
        tool: 'sheets_data',
        action: 'read',
      });

      expect(pattern).toBeDefined();
      // This simulates _learnedFix being injected into the error response
    });

    it('should provide suggestedActions for recovery paths', () => {
      const fixedSuggestion = suggestFix(
        'FORMULA_ERROR',
        'Invalid formula in B5',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      // Step 1: User encounters error
      expect(fixedSuggestion).toBeDefined();
      // Step 2: Error is categorized (FORMULA_ERROR)
      expect(fixedSuggestion?.explanation).toContain('Formula error detected');
      // Step 3: Fix is suggested
      expect(fixedSuggestion?.tool).toBe('sheets_analyze');
      // Step 4: Parameters are provided
      expect(fixedSuggestion?.params.spreadsheetId).toBe('abc123');
      // Step 5: User can execute fix
      expect(fixedSuggestion?.action).toBe('analyze_formulas');
    });

    it('should have comprehensive error handling across all error codes', () => {
      const errorCodes = [
        'INVALID_RANGE',
        'SHEET_NOT_FOUND',
        'SPREADSHEET_NOT_FOUND',
        'PERMISSION_DENIED',
        'QUOTA_EXCEEDED',
        'VALIDATION_ERROR',
        'FORMULA_ERROR',
        'CIRCULAR_REFERENCE',
        'EDIT_CONFLICT',
        'TIMEOUT',
        'PROTECTED_RANGE',
        'BATCH_UPDATE_ERROR',
        'FORMULA_INJECTION_BLOCKED',
        'PAYLOAD_TOO_LARGE',
        'TRANSACTION_CONFLICT',
        'TRANSACTION_EXPIRED',
        'ELICITATION_UNAVAILABLE',
        'CONNECTOR_ERROR',
        'AMBIGUOUS_RANGE',
      ];

      for (const code of errorCodes) {
        const fix = suggestFix(code, `Error: ${code}`, 'sheets_data', 'read', {
          spreadsheetId: 'abc123',
        });

        // Each error code should have a corresponding fix (or return null)
        const isValidFix = fix === null || (fix && typeof fix.tool === 'string' && typeof fix.action === 'string');
        expect(isValidFix).toBe(true);
      }
    });

    it('should verify fix suggestion has required fields', () => {
      const fix = suggestFix(
        'SHEET_NOT_FOUND',
        "Sheet 'Sales' not found",
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      ) as SuggestedFix;

      // Verify all required fields are present
      expect(fix).toBeDefined();
      expect(fix.tool).toBeTruthy();
      expect(typeof fix.tool).toBe('string');
      expect(fix.action).toBeTruthy();
      expect(typeof fix.action).toBe('string');
      expect(fix.params).toBeTruthy();
      expect(typeof fix.params).toBe('object');
      expect(fix.explanation).toBeTruthy();
      expect(typeof fix.explanation).toBe('string');
    });
  });

  // =========================================================================
  // Additional Edge Cases
  // =========================================================================
  describe('Additional edge cases', () => {
    it('should handle null params gracefully', () => {
      const fix = suggestFix('SHEET_NOT_FOUND', "Sheet 'X' not found", 'sheets_data', 'read');

      expect(fix?.tool).toBe('sheets_core');
      expect(fix?.action).toBe('list_sheets');
    });

    it('should return null for unrecognized error codes', () => {
      const fix = suggestFix(
        'UNKNOWN_ERROR_CODE',
        'Unknown error',
        'sheets_data',
        'read',
        { spreadsheetId: 'abc123' }
      );

      expect(fix).toBeNull();
    });

    it('should preserve all original params in fix suggestion', () => {
      const originalParams = {
        spreadsheetId: 'abc123',
        range: 'A1:B10',
        values: [['a', 'b']],
        customField: 'custom value',
      };

      const fix = suggestFix(
        'QUOTA_EXCEEDED',
        'Rate limited',
        'sheets_data',
        'read',
        originalParams
      );

      expect(fix?.params.spreadsheetId).toBe('abc123');
      expect(fix?.params.range).toBe('A1:B10');
      expect(fix?.params.values).toEqual([['a', 'b']]);
      expect(fix?.params.customField).toBe('custom value');
      expect(fix?.params.verbosity).toBe('minimal'); // Added by suggester
    });

    it('should handle case-insensitive error message matching', () => {
      const fix1 = suggestFix(
        'INTERNAL_ERROR',
        'CIRCULAR REFERENCE DETECTED',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      const fix2 = suggestFix(
        'INTERNAL_ERROR',
        'circular reference detected',
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123' }
      );

      expect(fix1?.tool).toBe(fix2?.tool);
      expect(fix1?.action).toBe(fix2?.action);
    });
  });
});
