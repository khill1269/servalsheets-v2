/**
 * ServalSheets - Batch Efficiency Monitoring
 *
 * Monitors and logs batch efficiency metrics
 */

import { logger } from './logger.js';
import type { Intent } from '../core/intent.js';

export interface BatchEfficiencyMetrics {
  intentCount: number;
  spreadsheetCount: number;
  averageIntentsPerSpreadsheet: number;
  potentialSavings: number; // Estimated API calls that could be saved
  timestamp: string;
}

// Track batch efficiency over time
const efficiencyHistory: BatchEfficiencyMetrics[] = [];
const MAX_HISTORY = 100;

/**
 * Analyze batch efficiency and log warnings if suboptimal
 */
export function analyzeBatchEfficiency(intents: Intent[]): BatchEfficiencyMetrics {
  const spreadsheetIds = new Set(intents.map((i) => i.target.spreadsheetId));
  const spreadsheetCount = spreadsheetIds.size;
  const intentCount = intents.length;
  const averageIntentsPerSpreadsheet = intentCount / Math.max(spreadsheetCount, 1);

  // Calculate potential savings
  // If we have < 5 intents per spreadsheet, there's room for improvement
  const potentialSavings =
    spreadsheetCount > 1 ? Math.max(0, spreadsheetCount - Math.ceil(intentCount / 10)) : 0;

  const metrics: BatchEfficiencyMetrics = {
    intentCount,
    spreadsheetCount,
    averageIntentsPerSpreadsheet: Math.round(averageIntentsPerSpreadsheet * 100) / 100,
    potentialSavings,
    timestamp: new Date().toISOString(),
  };

  // Add to history
  efficiencyHistory.push(metrics);
  if (efficiencyHistory.length > MAX_HISTORY) {
    efficiencyHistory.shift();
  }

  // Log warning for inefficient batching
  if (intentCount === 1) {
    logger.debug('Single-intent batch', {
      spreadsheetId: intents[0]?.target.spreadsheetId,
      intentType: intents[0]?.type,
    });
  } else if (intentCount < 5 && spreadsheetCount === 1) {
    logger.debug('Small batch detected', metrics);
  } else if (averageIntentsPerSpreadsheet < 3 && spreadsheetCount > 1) {
    logger.warn('Inefficient batch distribution', {
      ...metrics,
      recommendation: 'Consider grouping operations by spreadsheet before execution',
    });
  }

  return metrics;
}

/**
 * Get batch efficiency statistics
 */
export function getBatchEfficiencyStats(): {
  totalBatches: number;
  averageIntentsPerBatch: number;
  averageSpreadsheetsPerBatch: number;
  totalPotentialSavings: number;
} {
  if (efficiencyHistory.length === 0) {
    return {
      totalBatches: 0,
      averageIntentsPerBatch: 0,
      averageSpreadsheetsPerBatch: 0,
      totalPotentialSavings: 0,
    };
  }

  const totalIntents = efficiencyHistory.reduce((sum, m) => sum + m.intentCount, 0);
  const totalSpreadsheets = efficiencyHistory.reduce((sum, m) => sum + m.spreadsheetCount, 0);
  const totalPotentialSavings = efficiencyHistory.reduce((sum, m) => sum + m.potentialSavings, 0);

  return {
    totalBatches: efficiencyHistory.length,
    averageIntentsPerBatch: Math.round((totalIntents / efficiencyHistory.length) * 100) / 100,
    averageSpreadsheetsPerBatch:
      Math.round((totalSpreadsheets / efficiencyHistory.length) * 100) / 100,
    totalPotentialSavings,
  };
}

/**
 * Clear batch efficiency history
 */
export function clearBatchEfficiencyHistory(): void {
  efficiencyHistory.length = 0;
}

/**
 * Suggest batch optimization strategies
 */
export function suggestBatchOptimizations(intents: Intent[]): string[] {
  const suggestions: string[] = [];
  const metrics = analyzeBatchEfficiency(intents);

  if (metrics.intentCount === 1) {
    suggestions.push(
      'Single operation - consider accumulating multiple operations before execution'
    );
  }

  if (metrics.averageIntentsPerSpreadsheet < 3 && metrics.spreadsheetCount > 1) {
    suggestions.push(
      `Low intents per spreadsheet (${metrics.averageIntentsPerSpreadsheet}) - group by spreadsheet ID before batching`
    );
  }

  if (metrics.intentCount > 100) {
    suggestions.push(
      'Large batch detected - consider chunking into smaller batches for better error handling'
    );
  }

  const compatibleTypes = new Set<string>();
  for (const intent of intents) {
    compatibleTypes.add(intent.type);
  }

  if (compatibleTypes.size > 10) {
    suggestions.push(
      'Many different intent types - ensure they are actually compatible for batching'
    );
  }

  return suggestions;
}
