/**
 * OAuth Scope Configuration Tests
 *
 * Tests deployment-aware scope selection logic to ensure:
 * - Self-hosted defaults to full scopes (all actions)
 * - SaaS defaults to standard scopes (~85% of actions, faster verification)
 * - Explicit OAUTH_SCOPE_MODE overrides DEPLOYMENT_MODE
 * - All scope modes return correct scope sets
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getConfiguredScopes,
  getRecommendedScopes,
  FULL_ACCESS_SCOPES,
  STANDARD_SCOPES,
  MINIMAL_SCOPES,
  READONLY_SCOPES,
  validateScopes,
  formatScopesForAuth,
} from '../../src/config/oauth-scopes.js';
import { resetEnvForTest } from '../../src/config/env.js';

describe('OAuth Scope Configuration', () => {
  // Store original env vars
  const originalEnv = {
    OAUTH_SCOPE_MODE: process.env['OAUTH_SCOPE_MODE'],
    DEPLOYMENT_MODE: process.env['DEPLOYMENT_MODE'],
  };

  beforeEach(() => {
    // Clear env vars before each test
    delete process.env['OAUTH_SCOPE_MODE'];
    delete process.env['DEPLOYMENT_MODE'];
    // Reset cached env so getEnv() re-parses from process.env
    resetEnvForTest();
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnv.OAUTH_SCOPE_MODE !== undefined) {
      process.env['OAUTH_SCOPE_MODE'] = originalEnv.OAUTH_SCOPE_MODE;
    } else {
      delete process.env['OAUTH_SCOPE_MODE'];
    }
    if (originalEnv.DEPLOYMENT_MODE !== undefined) {
      process.env['DEPLOYMENT_MODE'] = originalEnv.DEPLOYMENT_MODE;
    } else {
      delete process.env['DEPLOYMENT_MODE'];
    }
    resetEnvForTest();
  });

  describe('Deployment-Aware Defaults', () => {
    it('defaults to full scopes for self-hosted deployment', () => {
      // No env vars = self-hosted default
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
      expect(scopes).toContain('https://www.googleapis.com/auth/drive');
      expect(scopes).toContain('https://www.googleapis.com/auth/bigquery');
      expect(scopes).toContain('https://www.googleapis.com/auth/script.projects');
    });

    it('defaults to full scopes when explicitly set to self-hosted', () => {
      process.env['DEPLOYMENT_MODE'] = 'self-hosted';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
    });

    it('uses standard scopes for SaaS deployment', () => {
      process.env['DEPLOYMENT_MODE'] = 'saas';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(STANDARD_SCOPES);
      expect(scopes).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.file');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/drive');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/bigquery');
    });

    it('getRecommendedScopes returns same as getConfiguredScopes', () => {
      const configured = getConfiguredScopes();
      const recommended = getRecommendedScopes();
      expect(recommended).toEqual(configured);
    });
  });

  describe('Explicit Scope Mode Override', () => {
    it('explicit full mode overrides saas deployment', () => {
      process.env['DEPLOYMENT_MODE'] = 'saas';
      process.env['OAUTH_SCOPE_MODE'] = 'full';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
    });

    it('explicit standard mode overrides self-hosted deployment', () => {
      process.env['DEPLOYMENT_MODE'] = 'self-hosted';
      process.env['OAUTH_SCOPE_MODE'] = 'standard';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(STANDARD_SCOPES);
    });

    it('explicit minimal mode works', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'minimal';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(MINIMAL_SCOPES);
    });

    it('explicit readonly mode works', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'readonly';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(READONLY_SCOPES);
    });

    it('OAUTH_SCOPE_MODE takes precedence over DEPLOYMENT_MODE', () => {
      process.env['DEPLOYMENT_MODE'] = 'saas';
      process.env['OAUTH_SCOPE_MODE'] = 'full';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
      expect(scopes).not.toEqual(STANDARD_SCOPES);
    });
  });

  describe('Scope Set Validation', () => {
    it('FULL_ACCESS_SCOPES includes all required scopes', () => {
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/drive');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/drive.appdata');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/bigquery');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/cloud-platform');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/script.projects');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/script.deployments');
      expect(FULL_ACCESS_SCOPES).toContain('https://www.googleapis.com/auth/script.processes');
    });

    it('STANDARD_SCOPES does not include restricted scopes', () => {
      expect(STANDARD_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(STANDARD_SCOPES).toContain('https://www.googleapis.com/auth/drive.file');
      expect(STANDARD_SCOPES).toContain('https://www.googleapis.com/auth/drive.appdata');
      // Should NOT have restricted scopes
      expect(STANDARD_SCOPES).not.toContain('https://www.googleapis.com/auth/drive');
      expect(STANDARD_SCOPES).not.toContain('https://www.googleapis.com/auth/bigquery');
      expect(STANDARD_SCOPES).not.toContain('https://www.googleapis.com/auth/cloud-platform');
    });

    it('MINIMAL_SCOPES has bare minimum', () => {
      expect(MINIMAL_SCOPES.length).toBe(2);
      expect(MINIMAL_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(MINIMAL_SCOPES).toContain('https://www.googleapis.com/auth/drive.file');
    });

    it('READONLY_SCOPES has only readonly permissions', () => {
      expect(READONLY_SCOPES).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
      expect(READONLY_SCOPES).toContain('https://www.googleapis.com/auth/drive.readonly');
      expect(READONLY_SCOPES.every((scope) => scope.includes('readonly'))).toBe(true);
    });

    it('all scope sets are readonly arrays', () => {
      // TypeScript enforces this at compile time, but verify at runtime
      expect(Array.isArray(FULL_ACCESS_SCOPES)).toBe(true);
      expect(Array.isArray(STANDARD_SCOPES)).toBe(true);
      expect(Array.isArray(MINIMAL_SCOPES)).toBe(true);
      expect(Array.isArray(READONLY_SCOPES)).toBe(true);
    });
  });

  describe('validateScopes', () => {
    it('validates all required scopes are present', () => {
      const current = Array.from(FULL_ACCESS_SCOPES);
      const required = ['https://www.googleapis.com/auth/spreadsheets'];
      const result = validateScopes(current, required);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('detects missing scopes', () => {
      const current = Array.from(STANDARD_SCOPES);
      const required = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/bigquery', // Not in STANDARD_SCOPES
      ];
      const result = validateScopes(current, required);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('https://www.googleapis.com/auth/bigquery');
    });

    it('returns all missing scopes', () => {
      const current = Array.from(MINIMAL_SCOPES);
      const required = Array.from(FULL_ACCESS_SCOPES);
      const result = validateScopes(current, required);
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
      expect(result.missing).toContain('https://www.googleapis.com/auth/drive');
      expect(result.missing).toContain('https://www.googleapis.com/auth/bigquery');
    });

    it('handles empty required scopes', () => {
      const current = Array.from(STANDARD_SCOPES);
      const required: readonly string[] = [];
      const result = validateScopes(current, required);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('handles empty current scopes', () => {
      const current: string[] = [];
      const required = ['https://www.googleapis.com/auth/spreadsheets'];
      const result = validateScopes(current, required);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(required);
    });
  });

  describe('formatScopesForAuth', () => {
    it('formats scopes as space-separated string', () => {
      const scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ];
      const formatted = formatScopesForAuth(scopes);
      expect(formatted).toBe(
        'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive'
      );
    });

    it('handles single scope', () => {
      const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
      const formatted = formatScopesForAuth(scopes);
      expect(formatted).toBe('https://www.googleapis.com/auth/spreadsheets');
    });

    it('handles empty scope array', () => {
      const scopes: readonly string[] = [];
      const formatted = formatScopesForAuth(scopes);
      expect(formatted).toBe('');
    });

    it('formats FULL_ACCESS_SCOPES correctly', () => {
      const formatted = formatScopesForAuth(FULL_ACCESS_SCOPES);
      expect(formatted).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(formatted).toContain('https://www.googleapis.com/auth/drive');
      expect(formatted.split(' ').length).toBe(FULL_ACCESS_SCOPES.length);
    });
  });

  describe('Backwards Compatibility', () => {
    it('existing deployments without env vars get full scopes', () => {
      // Simulate existing deployment with no env vars set
      delete process.env['OAUTH_SCOPE_MODE'];
      delete process.env['DEPLOYMENT_MODE'];
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
    });

    it('explicit OAUTH_SCOPE_MODE=full still works', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'full';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
    });

    it('explicit OAUTH_SCOPE_MODE=standard still works', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'standard';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(STANDARD_SCOPES);
    });
  });

  describe('Invalid/Unknown Modes', () => {
    it('unknown OAUTH_SCOPE_MODE defaults to standard', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'unknown';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(STANDARD_SCOPES);
    });

    it('unknown DEPLOYMENT_MODE defaults to self-hosted behavior', () => {
      process.env['DEPLOYMENT_MODE'] = 'unknown';
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
    });

    it('empty string OAUTH_SCOPE_MODE uses deployment mode default', () => {
      process.env['OAUTH_SCOPE_MODE'] = '';
      // Empty string is treated as not set, falls back to deployment mode
      // Default deployment mode is 'self-hosted' which uses full scopes
      const scopes = getConfiguredScopes();
      expect(scopes).toEqual(FULL_ACCESS_SCOPES);
    });
  });

  describe('Feature Availability by Scope Mode', () => {
    it('full mode enables all features (BigQuery, Apps Script, webhooks)', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'full';
      const scopes = getConfiguredScopes();

      // Check for BigQuery scopes
      expect(scopes).toContain('https://www.googleapis.com/auth/bigquery');
      expect(scopes).toContain('https://www.googleapis.com/auth/cloud-platform');

      // Check for Apps Script scopes
      expect(scopes).toContain('https://www.googleapis.com/auth/script.projects');
      expect(scopes).toContain('https://www.googleapis.com/auth/script.deployments');
      expect(scopes).toContain('https://www.googleapis.com/auth/script.processes');

      // Check for full Drive access (needed for sharing, comments, webhooks)
      expect(scopes).toContain('https://www.googleapis.com/auth/drive');
    });

    it('standard mode disables BigQuery, Apps Script, full sharing', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'standard';
      const scopes = getConfiguredScopes();

      // Should NOT have BigQuery scopes
      expect(scopes).not.toContain('https://www.googleapis.com/auth/bigquery');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/cloud-platform');

      // Should NOT have Apps Script scopes
      expect(scopes).not.toContain('https://www.googleapis.com/auth/script.projects');

      // Should NOT have full Drive access
      expect(scopes).not.toContain('https://www.googleapis.com/auth/drive');

      // Should still have basic Sheets + limited Drive
      expect(scopes).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.file');
    });

    it('minimal mode only enables core spreadsheet operations', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'minimal';
      const scopes = getConfiguredScopes();

      expect(scopes.length).toBe(2);
      expect(scopes).toContain('https://www.googleapis.com/auth/spreadsheets');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.file');
    });

    it('readonly mode only enables read operations', () => {
      process.env['OAUTH_SCOPE_MODE'] = 'readonly';
      const scopes = getConfiguredScopes();

      expect(scopes.every((scope) => scope.includes('readonly'))).toBe(true);
      expect(scopes).not.toContain('https://www.googleapis.com/auth/spreadsheets'); // No write
      expect(scopes).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
    });
  });
});
