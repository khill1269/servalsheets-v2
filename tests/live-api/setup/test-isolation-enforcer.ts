/**
 * Test Isolation Enforcer
 *
 * Ensures test isolation by tracking resources created during tests
 * and cleaning them up afterwards. Prevents test pollution.
 */

import type { LiveApiClient } from './live-api-client.js';
import { getMetricsCollector } from './metrics-collector.js';

export interface TrackedResource {
  type: 'spreadsheet' | 'sheet' | 'named_range' | 'protected_range' | 'chart' | 'permission';
  id: string;
  parentId?: string;
  createdAt: number;
  createdBy: string;
  cleaned: boolean;
}

export interface IsolationReport {
  testName: string;
  resourcesCreated: number;
  resourcesCleaned: number;
  resourcesLeaked: number;
  cleanupErrors: string[];
  duration: number;
}

/**
 * Test Isolation Enforcer singleton
 */
class TestIsolationEnforcer {
  private client: LiveApiClient | null = null;
  private trackedResources: Map<string, TrackedResource> = new Map();
  private currentTest: string | null = null;
  private reports: IsolationReport[] = [];
  private enabled = true;

  /**
   * Initialize with API client
   */
  initialize(client: LiveApiClient): void {
    this.client = client;
  }

  /**
   * Enable or disable isolation enforcement
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Start tracking for a test
   */
  startTest(testName: string): void {
    if (!this.enabled) return;
    this.currentTest = testName;
  }

  /**
   * Track a created resource
   */
  trackResource(resource: Omit<TrackedResource, 'createdAt' | 'createdBy' | 'cleaned'>): void {
    if (!this.enabled || !this.currentTest) return;

    const key = `${resource.type}:${resource.id}`;
    this.trackedResources.set(key, {
      ...resource,
      createdAt: Date.now(),
      createdBy: this.currentTest,
      cleaned: false,
    });
  }

  /**
   * Track spreadsheet creation
   */
  trackSpreadsheet(spreadsheetId: string): void {
    this.trackResource({ type: 'spreadsheet', id: spreadsheetId });
  }

  /**
   * Track sheet creation
   */
  trackSheet(spreadsheetId: string, sheetId: number): void {
    this.trackResource({
      type: 'sheet',
      id: String(sheetId),
      parentId: spreadsheetId,
    });
  }

  /**
   * Track named range creation
   */
  trackNamedRange(spreadsheetId: string, namedRangeId: string): void {
    this.trackResource({
      type: 'named_range',
      id: namedRangeId,
      parentId: spreadsheetId,
    });
  }

  /**
   * Track protected range creation
   */
  trackProtectedRange(spreadsheetId: string, protectedRangeId: number): void {
    this.trackResource({
      type: 'protected_range',
      id: String(protectedRangeId),
      parentId: spreadsheetId,
    });
  }

  /**
   * Track chart creation
   */
  trackChart(spreadsheetId: string, chartId: number): void {
    this.trackResource({
      type: 'chart',
      id: String(chartId),
      parentId: spreadsheetId,
    });
  }

  /**
   * Track permission creation
   */
  trackPermission(spreadsheetId: string, permissionId: string): void {
    this.trackResource({
      type: 'permission',
      id: permissionId,
      parentId: spreadsheetId,
    });
  }

  /**
   * Mark a resource as manually cleaned
   */
  markCleaned(type: TrackedResource['type'], id: string): void {
    const key = `${type}:${id}`;
    const resource = this.trackedResources.get(key);
    if (resource) {
      resource.cleaned = true;
    }
  }

  /**
   * End tracking for current test and clean up resources
   */
  async endTest(): Promise<IsolationReport> {
    if (!this.enabled || !this.currentTest) {
      return {
        testName: this.currentTest || 'unknown',
        resourcesCreated: 0,
        resourcesCleaned: 0,
        resourcesLeaked: 0,
        cleanupErrors: [],
        duration: 0,
      };
    }

    const startTime = Date.now();
    const testName = this.currentTest;
    const testResources = Array.from(this.trackedResources.values()).filter(
      (r) => r.createdBy === testName && !r.cleaned
    );

    let cleaned = 0;
    const errors: string[] = [];

    // Clean up in reverse order of dependencies
    // 1. Charts, named ranges, protected ranges, permissions
    // 2. Sheets
    // 3. Spreadsheets

    const dependentResources = testResources.filter(
      (r) => r.type !== 'spreadsheet' && r.type !== 'sheet'
    );
    const sheets = testResources.filter((r) => r.type === 'sheet');
    const spreadsheets = testResources.filter((r) => r.type === 'spreadsheet');

    // Clean dependent resources
    for (const resource of dependentResources) {
      try {
        await this.cleanResource(resource);
        resource.cleaned = true;
        cleaned++;
      } catch (error) {
        errors.push(`Failed to clean ${resource.type}:${resource.id}: ${error}`);
      }
    }

    // Clean sheets (only if parent spreadsheet is not being deleted)
    for (const sheet of sheets) {
      const parentBeingDeleted = spreadsheets.some((s) => s.id === sheet.parentId);
      if (!parentBeingDeleted) {
        try {
          await this.cleanResource(sheet);
          sheet.cleaned = true;
          cleaned++;
        } catch (error) {
          errors.push(`Failed to clean sheet:${sheet.id}: ${error}`);
        }
      } else {
        // Mark as cleaned since parent deletion will handle it
        sheet.cleaned = true;
        cleaned++;
      }
    }

    // Clean spreadsheets
    for (const spreadsheet of spreadsheets) {
      try {
        await this.cleanResource(spreadsheet);
        spreadsheet.cleaned = true;
        cleaned++;
      } catch (error) {
        errors.push(`Failed to clean spreadsheet:${spreadsheet.id}: ${error}`);
      }
    }

    const report: IsolationReport = {
      testName,
      resourcesCreated: testResources.length,
      resourcesCleaned: cleaned,
      resourcesLeaked: testResources.length - cleaned,
      cleanupErrors: errors,
      duration: Date.now() - startTime,
    };

    this.reports.push(report);
    this.currentTest = null;

    // Record metrics
    getMetricsCollector().recordApiCall(
      'write',
      'ISOLATION_CLEANUP',
      report.duration,
      report.resourcesLeaked === 0
    );

    return report;
  }

  /**
   * Clean a single resource
   */
  private async cleanResource(resource: TrackedResource): Promise<void> {
    if (!this.client || resource.cleaned) return;

    switch (resource.type) {
      case 'spreadsheet':
        await this.client.drive.files.delete({ fileId: resource.id });
        break;

      case 'sheet':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [{ deleteSheet: { sheetId: parseInt(resource.id, 10) } }],
            },
          });
        }
        break;

      case 'named_range':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [{ deleteNamedRange: { namedRangeId: resource.id } }],
            },
          });
        }
        break;

      case 'protected_range':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [{ deleteProtectedRange: { protectedRangeId: parseInt(resource.id, 10) } }],
            },
          });
        }
        break;

      case 'chart':
        if (resource.parentId) {
          await this.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: resource.parentId,
            requestBody: {
              requests: [{ deleteEmbeddedObject: { objectId: parseInt(resource.id, 10) } }],
            },
          });
        }
        break;

      case 'permission':
        if (resource.parentId) {
          await this.client.drive.permissions.delete({
            fileId: resource.parentId,
            permissionId: resource.id,
          });
        }
        break;
    }
  }

  /**
   * Get all isolation reports
   */
  getReports(): IsolationReport[] {
    return [...this.reports];
  }

  /**
   * Get summary of all reports
   */
  getSummary(): {
    totalTests: number;
    totalResourcesCreated: number;
    totalResourcesCleaned: number;
    totalResourcesLeaked: number;
    totalCleanupErrors: number;
    testsWithLeaks: string[];
  } {
    const testsWithLeaks = this.reports.filter((r) => r.resourcesLeaked > 0).map((r) => r.testName);

    return {
      totalTests: this.reports.length,
      totalResourcesCreated: this.reports.reduce((sum, r) => sum + r.resourcesCreated, 0),
      totalResourcesCleaned: this.reports.reduce((sum, r) => sum + r.resourcesCleaned, 0),
      totalResourcesLeaked: this.reports.reduce((sum, r) => sum + r.resourcesLeaked, 0),
      totalCleanupErrors: this.reports.reduce((sum, r) => sum + r.cleanupErrors.length, 0),
      testsWithLeaks,
    };
  }

  /**
   * Reset all tracking
   */
  reset(): void {
    this.trackedResources.clear();
    this.currentTest = null;
    this.reports = [];
  }

  /**
   * Assert no resource leaks (for use in afterAll)
   */
  assertNoLeaks(): void {
    const summary = this.getSummary();
    if (summary.totalResourcesLeaked > 0) {
      const leakDetails = this.reports
        .filter((r) => r.resourcesLeaked > 0)
        .map((r) => `  ${r.testName}: ${r.resourcesLeaked} leaked`)
        .join('\n');

      throw new Error(
        `Resource leak detected!\n` +
          `Total leaked: ${summary.totalResourcesLeaked}\n` +
          `Tests with leaks:\n${leakDetails}`
      );
    }
  }
}

// Singleton instance
export const testIsolationEnforcer = new TestIsolationEnforcer();

/**
 * Helper to wrap test with isolation enforcement
 */
export function withIsolation<T>(testName: string, testFn: () => Promise<T>): () => Promise<T> {
  return async () => {
    testIsolationEnforcer.startTest(testName);
    try {
      return await testFn();
    } finally {
      await testIsolationEnforcer.endTest();
    }
  };
}
