/**
 * Response Diff Utility
 *
 * Compares two responses and generates a detailed diff report.
 * Highlights additions, deletions, and modifications.
 */

import { diff as deepDiff } from 'deep-diff';

/**
 * Diff change types
 */
export type DiffChangeType = 'added' | 'deleted' | 'modified' | 'unchanged';

/**
 * Diff entry representing a single change
 */
export interface DiffEntry {
  type: DiffChangeType;
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  description: string;
}

/**
 * Response diff result
 */
export interface ResponseDiff {
  identical: boolean;
  changeCount: number;
  additions: DiffEntry[];
  deletions: DiffEntry[];
  modifications: DiffEntry[];
  summary: string;
}

/**
 * Compare two responses and generate a detailed diff
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep-diff accepts any
export function diffResponses(original: any, actual: any): ResponseDiff {
  const changes = deepDiff(original, actual);

  if (!changes || changes.length === 0) {
    return {
      identical: true,
      changeCount: 0,
      additions: [],
      deletions: [],
      modifications: [],
      summary: 'Responses are identical',
    };
  }

  const additions: DiffEntry[] = [];
  const deletions: DiffEntry[] = [];
  const modifications: DiffEntry[] = [];

  for (const change of changes) {
    const entry = convertDiffToEntry(change);

    switch (entry.type) {
      case 'added':
        additions.push(entry);
        break;
      case 'deleted':
        deletions.push(entry);
        break;
      case 'modified':
        modifications.push(entry);
        break;
    }
  }

  const changeCount = additions.length + deletions.length + modifications.length;

  const summary = [
    `${changeCount} change(s) detected:`,
    additions.length > 0 ? `${additions.length} addition(s)` : null,
    deletions.length > 0 ? `${deletions.length} deletion(s)` : null,
    modifications.length > 0 ? `${modifications.length} modification(s)` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    identical: false,
    changeCount,
    additions,
    deletions,
    modifications,
    summary,
  };
}

/**
 * Convert deep-diff change to DiffEntry
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep-diff untyped
function convertDiffToEntry(change: any): DiffEntry {
  const path = formatPath(change.path);

  switch (change.kind) {
    case 'N': // New property
      return {
        type: 'added',
        path,
        newValue: change.rhs,
        description: `Added: ${path} = ${formatValue(change.rhs)}`,
      };

    case 'D': // Deleted property
      return {
        type: 'deleted',
        path,
        oldValue: change.lhs,
        description: `Deleted: ${path} (was ${formatValue(change.lhs)})`,
      };

    case 'E': // Edited property
      return {
        type: 'modified',
        path,
        oldValue: change.lhs,
        newValue: change.rhs,
        description: `Modified: ${path} from ${formatValue(change.lhs)} to ${formatValue(change.rhs)}`,
      };

    case 'A': // Array change
      return {
        type: 'modified',
        path: `${path}[${change.index}]`,
        description: `Array change at ${path}[${change.index}]`,
      };

    default:
      return {
        type: 'modified',
        path,
        description: `Unknown change at ${path}`,
      };
  }
}

/**
 * Format path array into dot notation
 */
function formatPath(path: Array<string | number> | undefined): string {
  if (!path || path.length === 0) return 'root';

  return path
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}

/**
 * Format value for display
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'string':
      return `"${truncate(value, 50)}"`;
    case 'number':
    case 'boolean':
      return String(value);
    case 'object':
      if (Array.isArray(value)) {
        return `Array(${value.length})`;
      }
      return `Object(${Object.keys(value).length} keys)`;
    default:
      return String(value);
  }
}

/**
 * Truncate string for display
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}

/**
 * Generate a human-readable diff report
 */
export function formatDiffReport(diff: ResponseDiff): string {
  if (diff.identical) {
    return '✅ Responses are identical\n';
  }

  const lines: string[] = [];

  lines.push(`❌ Responses differ: ${diff.summary}\n`);

  if (diff.additions.length > 0) {
    lines.push('➕ Additions:');
    diff.additions.forEach((entry) => {
      lines.push(`  ${entry.description}`);
    });
    lines.push('');
  }

  if (diff.deletions.length > 0) {
    lines.push('➖ Deletions:');
    diff.deletions.forEach((entry) => {
      lines.push(`  ${entry.description}`);
    });
    lines.push('');
  }

  if (diff.modifications.length > 0) {
    lines.push('🔄 Modifications:');
    diff.modifications.forEach((entry) => {
      lines.push(`  ${entry.description}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a JSON diff report
 */
export function formatDiffJSON(diff: ResponseDiff): string {
  return JSON.stringify(diff, null, 2);
}

/**
 * Check if specific field changed
 */
export function hasFieldChanged(diff: ResponseDiff, fieldPath: string): boolean {
  const allChanges = [...diff.additions, ...diff.deletions, ...diff.modifications];
  return allChanges.some(
    (entry) => entry.path === fieldPath || entry.path.startsWith(`${fieldPath}.`)
  );
}

/**
 * Get changes for a specific field
 */
export function getFieldChanges(diff: ResponseDiff, fieldPath: string): DiffEntry[] {
  const allChanges = [...diff.additions, ...diff.deletions, ...diff.modifications];
  return allChanges.filter(
    (entry) => entry.path === fieldPath || entry.path.startsWith(`${fieldPath}.`)
  );
}

/**
 * Calculate similarity score (0-1)
 */
export function calculateSimilarity(diff: ResponseDiff, totalFields: number): number {
  if (diff.identical) return 1.0;
  if (totalFields === 0) return 0.0;

  const changedFields = diff.changeCount;
  return Math.max(0, 1 - changedFields / totalFields);
}
