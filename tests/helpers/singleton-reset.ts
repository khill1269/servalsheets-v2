/**
 * Singleton Reset Helper
 *
 * Centralizes reset logic for singleton services in tests.
 */

import { resetAccessPatternTracker } from '../../src/services/access-pattern-tracker.js';
import { resetBatchingSystem } from '../../src/services/batching-system.js';
import { resetCapabilityCacheService } from '../../src/services/capability-cache.js';
import { resetCompositeOperations } from '../../src/services/composite-operations.js';
import { resetConfirmationService } from '../../src/services/confirm-service.js';
import { resetConflictDetector } from '../../src/services/conflict-detector.js';
import { resetContextManager } from '../../src/services/context-manager.js';
import { resetHistoryService } from '../../src/services/history-service.js';
import { resetImpactAnalyzer } from '../../src/services/impact-analyzer.js';
import { resetMetricsService } from '../../src/services/metrics.js';
import { resetParallelExecutor } from '../../src/services/parallel-executor.js';
import { resetPrefetchPredictor } from '../../src/services/prefetch-predictor.js';
import { resetPrefetchingSystem } from '../../src/services/prefetching-system.js';
import { resetSamplingAnalysisService } from '../../src/services/sampling-analysis.js';
import { resetSheetResolver } from '../../src/services/sheet-resolver.js';
import { resetTokenManager } from '../../src/services/token-manager.js';
import { resetTransactionManager } from '../../src/services/transaction-manager.js';
import { resetValidationEngine } from '../../src/services/validation-engine.js';

export type SingletonName =
  | 'access-pattern-tracker'
  | 'batching-system'
  | 'capability-cache'
  | 'composite-operations'
  | 'confirm-service'
  | 'conflict-detector'
  | 'context-manager'
  | 'history-service'
  | 'impact-analyzer'
  | 'metrics'
  | 'parallel-executor'
  | 'prefetch-predictor'
  | 'prefetching-system'
  | 'sampling-analysis'
  | 'sheet-resolver'
  | 'token-manager'
  | 'transaction-manager'
  | 'validation-engine';

/**
 * Reset all singleton services.
 */
export function resetAllSingletons(): void {
  resetAccessPatternTracker();
  resetBatchingSystem();
  resetCapabilityCacheService();
  resetCompositeOperations();
  resetConfirmationService();
  resetConflictDetector();
  resetContextManager();
  resetHistoryService();
  resetImpactAnalyzer();
  resetMetricsService();
  resetParallelExecutor();
  resetPrefetchPredictor();
  resetPrefetchingSystem();
  resetSamplingAnalysisService();
  resetSheetResolver();
  resetTokenManager();
  resetTransactionManager();
  resetValidationEngine();
}

/**
 * Reset a specific singleton by name.
 */
export function resetSingleton(name: SingletonName): void {
  switch (name) {
    case 'access-pattern-tracker':
      resetAccessPatternTracker();
      return;
    case 'batching-system':
      resetBatchingSystem();
      return;
    case 'capability-cache':
      resetCapabilityCacheService();
      return;
    case 'composite-operations':
      resetCompositeOperations();
      return;
    case 'confirm-service':
      resetConfirmationService();
      return;
    case 'conflict-detector':
      resetConflictDetector();
      return;
    case 'context-manager':
      resetContextManager();
      return;
    case 'history-service':
      resetHistoryService();
      return;
    case 'impact-analyzer':
      resetImpactAnalyzer();
      return;
    case 'metrics':
      resetMetricsService();
      return;
    case 'parallel-executor':
      resetParallelExecutor();
      return;
    case 'prefetch-predictor':
      resetPrefetchPredictor();
      return;
    case 'prefetching-system':
      resetPrefetchingSystem();
      return;
    case 'sampling-analysis':
      resetSamplingAnalysisService();
      return;
    case 'sheet-resolver':
      resetSheetResolver();
      return;
    case 'token-manager':
      resetTokenManager();
      return;
    case 'transaction-manager':
      resetTransactionManager();
      return;
    case 'validation-engine':
      resetValidationEngine();
      return;
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown singleton: ${exhaustive}`);
    }
  }
}
