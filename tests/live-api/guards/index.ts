/**
 * ServalSheets - Test Guards
 *
 * Barrel export for all test guard components.
 */

// Pre-Test Validator
export {
  PreTestValidator,
  getPreTestValidator,
  resetPreTestValidator,
  validatePreTestConditions,
  assertPreTestConditions,
  shouldSkipTests,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type PreTestValidationOptions,
} from './pre-test-validator.js';

// Breaking Change Detector
export {
  BreakingChangeDetector,
  getBreakingChangeDetector,
  resetBreakingChangeDetector,
  registerServalContracts,
  SERVAL_CONTRACTS,
  type SchemaField,
  type ApiContract,
  type BreakingChangeResult,
  type BreakingChange,
  type ResponseSnapshot,
} from './breaking-change-detector.js';

// Test Isolation Guard
export {
  TestIsolationGuard,
  getTestIsolationGuard,
  resetTestIsolationGuard,
  trackSpreadsheet,
  trackSheet,
  untrackSpreadsheet,
  untrackSheet,
  withIsolation,
  assertIsolated,
  type ResourceType,
  type TrackedResource,
  type IsolationCheckResult,
  type CleanupResult,
} from './test-isolation-guard.js';
