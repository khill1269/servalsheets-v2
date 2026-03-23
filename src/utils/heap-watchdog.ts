/**
 * Heap Watchdog (ISSUE-115)
 *
 * Monitors Node.js heap usage every 5 seconds and sets a module-level pressure
 * level that analysis handlers can check before starting expensive operations.
 *
 * Pressure levels:
 *   normal   — heap < 80%: all features enabled
 *   elevated — heap 80-90%: background analysis disabled
 *   critical — heap > 90%: new analysis requests rejected with RESOURCE_EXHAUSTED
 */

import { logger } from './logger.js';

export type HeapPressureLevel = 'normal' | 'elevated' | 'critical';

let _pressureLevel: HeapPressureLevel = 'normal';
let _watchdogTimer: NodeJS.Timeout | null = null;

/** Thresholds configurable via env vars */
const ELEVATED_THRESHOLD = parseFloat(process.env['HEAP_ELEVATED_THRESHOLD'] ?? '0.80');
const CRITICAL_THRESHOLD = parseFloat(process.env['HEAP_CRITICAL_THRESHOLD'] ?? '0.90');
const WATCHDOG_INTERVAL_MS = parseInt(process.env['HEAP_WATCHDOG_INTERVAL_MS'] ?? '5000', 10);

/**
 * Get the current heap pressure level.
 * Returns 'normal' if the watchdog has not been started.
 */
export function getHeapPressureLevel(): HeapPressureLevel {
  return _pressureLevel;
}

/**
 * Returns true if new analysis requests should be rejected.
 */
export function isHeapCritical(): boolean {
  return _pressureLevel === 'critical';
}

/**
 * Returns true if background analysis should be suppressed.
 */
export function isHeapElevated(): boolean {
  return _pressureLevel === 'elevated' || _pressureLevel === 'critical';
}

/**
 * Start the heap watchdog. Call once during server initialization.
 * The timer is unref'd so it does not prevent process exit.
 */
export function startHeapWatchdog(): void {
  if (_watchdogTimer) return; // Already running

  _watchdogTimer = setInterval(() => {
    const { heapUsed, heapTotal } = process.memoryUsage();
    // Use heapTotal as denominator (reflects actual allocated heap, not V8 heap limit)
    const utilization = heapUsed / heapTotal;

    const previousLevel = _pressureLevel;

    if (utilization >= CRITICAL_THRESHOLD) {
      _pressureLevel = 'critical';
    } else if (utilization >= ELEVATED_THRESHOLD) {
      _pressureLevel = 'elevated';
    } else {
      _pressureLevel = 'normal';
    }

    if (_pressureLevel !== previousLevel) {
      const heapUsedMB = (heapUsed / 1024 / 1024).toFixed(1);
      const heapTotalMB = (heapTotal / 1024 / 1024).toFixed(1);

      if (_pressureLevel === 'critical') {
        logger.error('Heap pressure CRITICAL — rejecting new analysis requests', {
          component: 'heap-watchdog',
          heapUsedMB,
          heapTotalMB,
          utilizationPct: (utilization * 100).toFixed(1),
          threshold: CRITICAL_THRESHOLD,
        });
      } else if (_pressureLevel === 'elevated') {
        logger.warn('Heap pressure ELEVATED — disabling background analysis', {
          component: 'heap-watchdog',
          heapUsedMB,
          heapTotalMB,
          utilizationPct: (utilization * 100).toFixed(1),
          threshold: ELEVATED_THRESHOLD,
        });
      } else {
        logger.info('Heap pressure returned to normal', {
          component: 'heap-watchdog',
          heapUsedMB,
          heapTotalMB,
          utilizationPct: (utilization * 100).toFixed(1),
          previousLevel,
        });
      }
    }
  }, WATCHDOG_INTERVAL_MS);

  // Don't hold the process open just for the watchdog
  _watchdogTimer.unref();

  logger.debug('Heap watchdog started', {
    component: 'heap-watchdog',
    elevatedThreshold: `${(ELEVATED_THRESHOLD * 100).toFixed(0)}%`,
    criticalThreshold: `${(CRITICAL_THRESHOLD * 100).toFixed(0)}%`,
    intervalMs: WATCHDOG_INTERVAL_MS,
  });
}

/**
 * Stop the heap watchdog (for testing or graceful shutdown).
 */
export function stopHeapWatchdog(): void {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer);
    _watchdogTimer = null;
    _pressureLevel = 'normal';
  }
}
