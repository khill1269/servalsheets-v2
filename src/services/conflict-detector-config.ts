import type {
  ConflictDetectorConfig,
  ConflictDetectorStats,
  ResolutionStrategy,
} from '../types/conflict.js';

export function normalizeConflictDetectorConfig(
  config: ConflictDetectorConfig
): Required<Omit<ConflictDetectorConfig, 'googleClient'>> {
  return {
    enabled: config.enabled ?? true,
    checkBeforeWrite: config.checkBeforeWrite ?? true,
    autoResolve: config.autoResolve ?? false,
    defaultResolution: config.defaultResolution ?? 'manual',
    versionCacheTtl: config.versionCacheTtl ?? 300000,
    maxVersionsToCache: config.maxVersionsToCache ?? 1000,
    optimisticLocking: config.optimisticLocking ?? false,
    conflictCheckTimeoutMs: config.conflictCheckTimeoutMs ?? 5000,
    verboseLogging: config.verboseLogging ?? false,
  };
}

export function createInitialConflictDetectorStats(): ConflictDetectorStats {
  return {
    totalChecks: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    conflictsAutoResolved: 0,
    conflictsManuallyResolved: 0,
    detectionRate: 0,
    resolutionSuccessRate: 0,
    avgResolutionTime: 0,
    resolutionsByStrategy: {
      overwrite: 0,
      merge: 0,
      cancel: 0,
      manual: 0,
      last_write_wins: 0,
      first_write_wins: 0,
    },
    cacheHitRate: 0,
    versionsTracked: 0,
  };
}

export function getConflictDetectorEnvConfig(
  googleClient?: ConflictDetectorConfig['googleClient']
): ConflictDetectorConfig {
  return {
    enabled: process.env['CONFLICT_DETECTION_ENABLED'] !== 'false',
    checkBeforeWrite: process.env['CONFLICT_CHECK_BEFORE_WRITE'] !== 'false',
    autoResolve: process.env['CONFLICT_AUTO_RESOLVE'] === 'true',
    defaultResolution:
      (process.env['CONFLICT_DEFAULT_RESOLUTION'] as ResolutionStrategy) || 'manual',
    versionCacheTtl: parseInt(process.env['CONFLICT_VERSION_CACHE_TTL'] || '300000', 10),
    maxVersionsToCache: parseInt(process.env['CONFLICT_MAX_VERSIONS_TO_CACHE'] || '1000', 10),
    optimisticLocking: process.env['CONFLICT_OPTIMISTIC_LOCKING'] === 'true',
    conflictCheckTimeoutMs: parseInt(process.env['CONFLICT_CHECK_TIMEOUT_MS'] || '5000', 10),
    verboseLogging: process.env['CONFLICT_VERBOSE'] === 'true',
    googleClient,
  };
}
