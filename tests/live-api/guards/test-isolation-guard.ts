/**
 * ServalSheets - Test Isolation Guard
 *
 * Ensures proper test isolation by tracking resources and verifying cleanup.
 * Prevents test pollution and resource leaks.
 */

import type { LiveApiClient } from '../setup/live-api-client.js';

/**
 * Resource types tracked by the guard
 */
export type ResourceType =
  | 'spreadsheet'
  | 'sheet'
  | 'namedRange'
  | 'chart'
  | 'filter'
  | 'protection';

/**
 * Tracked resource
 */
export interface TrackedResource {
  type: ResourceType;
  id: string;
  parentId?: string; // e.g., spreadsheetId for sheets
  createdAt: number;
  createdBy: string; // test name
  metadata?: Record<string, unknown>;
}

/**
 * Isolation check result
 */
export interface IsolationCheckResult {
  isolated: boolean;
  leakedResources: TrackedResource[];
  orphanedResources: TrackedResource[];
  cleanupRequired: boolean;
  summary: string;
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  success: boolean;
  cleaned: number;
  failed: number;
  errors: Array<{ resource: TrackedResource; error: string }>;
}

/**
 * Test Isolation Guard
 */
export class TestIsolationGuard {
  private resources: Map<string, TrackedResource> = new Map();
  private testStack: string[] = [];
  private client: LiveApiClient | null = null;

  /**
   * Set the API client for cleanup operations
   */
  setClient(client: LiveApiClient): void {
    this.client = client;
  }

  /**
   * Enter a test context
   */
  enterTest(testName: string): void {
    this.testStack.push(testName);
  }

  /**
   * Exit a test context
   */
  exitTest(): string | undefined {
    return this.testStack.pop();
  }

  /**
   * Get current test name
   */
  getCurrentTest(): string | undefined {
    return this.testStack[this.testStack.length - 1];
  }

  /**
   * Track a created resource
   */
  trackResource(
    type: ResourceType,
    id: string,
    options: {
      parentId?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): TrackedResource {
    const resource: TrackedResource = {
      type,
      id,
      parentId: options.parentId,
      createdAt: Date.now(),
      createdBy: this.getCurrentTest() ?? 'unknown',
      metadata: options.metadata,
    };

    const key = `${type}:${id}`;
    this.resources.set(key, resource);

    return resource;
  }

  /**
   * Mark a resource as cleaned up
   */
  untrackResource(type: ResourceType, id: string): boolean {
    const key = `${type}:${id}`;
    return this.resources.delete(key);
  }

  /**
   * Get all tracked resources
   */
  getTrackedResources(): TrackedResource[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get resources created by a specific test
   */
  getResourcesByTest(testName: string): TrackedResource[] {
    return this.getTrackedResources().filter((r) => r.createdBy === testName);
  }

  /**
   * Get resources of a specific type
   */
  getResourcesByType(type: ResourceType): TrackedResource[] {
    return this.getTrackedResources().filter((r) => r.type === type);
  }

  /**
   * Check for resource leaks from a test
   */
  checkTestIsolation(testName: string): IsolationCheckResult {
    const testResources = this.getResourcesByTest(testName);
    const leakedResources = testResources.filter((r) => !this.isResourceCleaned(r));

    // Check for orphaned resources (parent no longer exists)
    const orphanedResources: TrackedResource[] = [];
    for (const resource of testResources) {
      if (resource.parentId && !this.resourceExists('spreadsheet', resource.parentId)) {
        orphanedResources.push(resource);
      }
    }

    const isolated = leakedResources.length === 0 && orphanedResources.length === 0;

    return {
      isolated,
      leakedResources,
      orphanedResources,
      cleanupRequired: !isolated,
      summary: this.generateIsolationSummary(leakedResources, orphanedResources),
    };
  }

  /**
   * Check overall isolation status
   */
  checkOverallIsolation(): IsolationCheckResult {
    const allResources = this.getTrackedResources();
    const leakedResources = allResources;
    const orphanedResources: TrackedResource[] = [];

    for (const resource of allResources) {
      if (resource.parentId && !this.resourceExists('spreadsheet', resource.parentId)) {
        orphanedResources.push(resource);
      }
    }

    const isolated = leakedResources.length === 0;

    return {
      isolated,
      leakedResources,
      orphanedResources,
      cleanupRequired: !isolated,
      summary: this.generateIsolationSummary(leakedResources, orphanedResources),
    };
  }

  /**
   * Clean up resources for a specific test
   */
  async cleanupTest(testName: string): Promise<CleanupResult> {
    const resources = this.getResourcesByTest(testName);
    return this.cleanupResources(resources);
  }

  /**
   * Clean up all tracked resources
   */
  async cleanupAll(): Promise<CleanupResult> {
    const resources = this.getTrackedResources();
    return this.cleanupResources(resources);
  }

  /**
   * Clean up specific resources
   */
  private async cleanupResources(resources: TrackedResource[]): Promise<CleanupResult> {
    const errors: Array<{ resource: TrackedResource; error: string }> = [];
    let cleaned = 0;
    let failed = 0;

    // Sort resources by type - delete children before parents
    const sortedResources = this.sortResourcesForCleanup(resources);

    for (const resource of sortedResources) {
      try {
        await this.cleanupResource(resource);
        this.untrackResource(resource.type, resource.id);
        cleaned++;
      } catch (error) {
        failed++;
        errors.push({
          resource,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: failed === 0,
      cleaned,
      failed,
      errors,
    };
  }

  /**
   * Clean up a single resource
   */
  private async cleanupResource(resource: TrackedResource): Promise<void> {
    if (!this.client) {
      throw new Error('No client set for cleanup operations');
    }

    switch (resource.type) {
      case 'spreadsheet':
        await this.client.drive.files.delete({ fileId: resource.id });
        break;

      case 'sheet':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [
                {
                  deleteSheet: { sheetId: parseInt(resource.id, 10) },
                },
              ],
            },
          });
        }
        break;

      case 'namedRange':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [
                {
                  deleteNamedRange: { namedRangeId: resource.id },
                },
              ],
            },
          });
        }
        break;

      case 'chart':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [
                {
                  deleteEmbeddedObject: { objectId: parseInt(resource.id, 10) },
                },
              ],
            },
          });
        }
        break;

      case 'filter':
        if (resource.parentId && resource.metadata?.sheetId !== undefined) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [
                {
                  clearBasicFilter: {
                    sheetId: resource.metadata.sheetId as number,
                  },
                },
              ],
            },
          });
        }
        break;

      case 'protection':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [
                {
                  deleteProtectedRange: { protectedRangeId: parseInt(resource.id, 10) },
                },
              ],
            },
          });
        }
        break;
    }
  }

  /**
   * Sort resources for cleanup (children before parents)
   */
  private sortResourcesForCleanup(resources: TrackedResource[]): TrackedResource[] {
    const priority: Record<ResourceType, number> = {
      chart: 1,
      filter: 1,
      protection: 1,
      namedRange: 2,
      sheet: 3,
      spreadsheet: 4,
    };

    return [...resources].sort((a, b) => priority[a.type] - priority[b.type]);
  }

  /**
   * Check if a resource exists
   */
  private resourceExists(type: ResourceType, id: string): boolean {
    const key = `${type}:${id}`;
    return this.resources.has(key);
  }

  /**
   * Check if a resource has been cleaned
   */
  private isResourceCleaned(resource: TrackedResource): boolean {
    const key = `${resource.type}:${resource.id}`;
    return !this.resources.has(key);
  }

  /**
   * Generate isolation summary
   */
  private generateIsolationSummary(leaked: TrackedResource[], orphaned: TrackedResource[]): string {
    if (leaked.length === 0 && orphaned.length === 0) {
      return 'Test isolation verified - no resource leaks.';
    }

    const parts: string[] = [];

    if (leaked.length > 0) {
      const byType = this.groupByType(leaked);
      const typeCounts = Object.entries(byType)
        .map(([type, resources]) => `${resources.length} ${type}(s)`)
        .join(', ');
      parts.push(`Leaked resources: ${typeCounts}`);
    }

    if (orphaned.length > 0) {
      parts.push(`Orphaned resources: ${orphaned.length}`);
    }

    return parts.join('; ');
  }

  /**
   * Group resources by type
   */
  private groupByType(resources: TrackedResource[]): Record<ResourceType, TrackedResource[]> {
    const grouped: Partial<Record<ResourceType, TrackedResource[]>> = {};

    for (const resource of resources) {
      if (!grouped[resource.type]) {
        grouped[resource.type] = [];
      }
      grouped[resource.type]!.push(resource);
    }

    return grouped as Record<ResourceType, TrackedResource[]>;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalTracked: number;
    byType: Record<ResourceType, number>;
    byTest: Record<string, number>;
    oldestResource?: TrackedResource;
  } {
    const resources = this.getTrackedResources();
    const byType: Partial<Record<ResourceType, number>> = {};
    const byTest: Record<string, number> = {};

    for (const resource of resources) {
      byType[resource.type] = (byType[resource.type] ?? 0) + 1;
      byTest[resource.createdBy] = (byTest[resource.createdBy] ?? 0) + 1;
    }

    const oldestResource =
      resources.length > 0
        ? resources.reduce((oldest, r) => (r.createdAt < oldest.createdAt ? r : oldest))
        : undefined;

    return {
      totalTracked: resources.length,
      byType: byType as Record<ResourceType, number>,
      byTest,
      oldestResource,
    };
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.resources.clear();
    this.testStack = [];
  }
}

/**
 * Singleton instance
 */
let _instance: TestIsolationGuard | null = null;

/**
 * Get the singleton guard
 */
export function getTestIsolationGuard(): TestIsolationGuard {
  if (!_instance) {
    _instance = new TestIsolationGuard();
  }
  return _instance;
}

/**
 * Reset the singleton
 */
export function resetTestIsolationGuard(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

/**
 * Convenience: Track a spreadsheet
 */
export function trackSpreadsheet(id: string, metadata?: Record<string, unknown>): TrackedResource {
  return getTestIsolationGuard().trackResource('spreadsheet', id, { metadata });
}

/**
 * Convenience: Track a sheet
 */
export function trackSheet(
  sheetId: string,
  spreadsheetId: string,
  metadata?: Record<string, unknown>
): TrackedResource {
  return getTestIsolationGuard().trackResource('sheet', sheetId, {
    parentId: spreadsheetId,
    metadata,
  });
}

/**
 * Convenience: Untrack a spreadsheet
 */
export function untrackSpreadsheet(id: string): boolean {
  return getTestIsolationGuard().untrackResource('spreadsheet', id);
}

/**
 * Convenience: Untrack a sheet
 */
export function untrackSheet(sheetId: string): boolean {
  return getTestIsolationGuard().untrackResource('sheet', sheetId);
}

/**
 * Create a test wrapper that ensures cleanup
 */
export function withIsolation<T>(
  testName: string,
  testFn: () => Promise<T>,
  options: { cleanup?: boolean } = {}
): () => Promise<T> {
  return async () => {
    const guard = getTestIsolationGuard();
    guard.enterTest(testName);

    try {
      return await testFn();
    } finally {
      if (options.cleanup !== false) {
        await guard.cleanupTest(testName);
      }
      guard.exitTest();
    }
  };
}

/**
 * Assert that a test is properly isolated
 */
export function assertIsolated(testName: string): void {
  const result = getTestIsolationGuard().checkTestIsolation(testName);
  if (!result.isolated) {
    throw new Error(`Test "${testName}" is not properly isolated: ${result.summary}`);
  }
}
