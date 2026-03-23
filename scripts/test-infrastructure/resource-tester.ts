/**
 * Resource Tester - Test all MCP resource endpoints
 * Dynamically discovers and tests: knowledge, history, cache, metrics, and feature resources
 */

import type { TestDatabase } from './test-db.js';
import type { TestLogger } from './logger.js';
import { listKnowledgeResources } from '../../src/resources/knowledge.js';

export interface ResourceTest {
  uri: string;
  category: string;
  description: string;
  expectedFields?: string[];
}

export interface ResourceTestResult {
  uri: string;
  status: 'pass' | 'fail' | 'skip';
  accessible: boolean;
  contentValid: boolean;
  hasMetadata: boolean;
  contentSize?: number;
  mimeType?: string;
  error?: string;
  duration: number;
}

export class ResourceTester {
  private resources: ResourceTest[] = [];

  constructor() {
    this.discoverResources();
  }

  /**
   * Discover all resource URIs based on server registration
   */
  private discoverResources(): void {
    // Knowledge resources - dynamically discovered from actual files
    const knowledgeResources = listKnowledgeResources();
    for (const resource of knowledgeResources) {
      this.resources.push({
        uri: resource.uri,
        category: 'knowledge',
        description: resource.description,
      });
    }

    // History resources (4) - dynamic runtime data, no field validation
    this.resources.push(
      {
        uri: 'history://operations',
        category: 'history',
        description: 'Full history with filters',
      },
      {
        uri: 'history://stats',
        category: 'history',
        description: 'History statistics',
      },
      {
        uri: 'history://recent',
        category: 'history',
        description: 'Last 10 operations',
      },
      {
        uri: 'history://failures',
        category: 'history',
        description: 'Failed operations only',
      }
    );

    // Cache resources (2) - dynamic runtime data, no field validation
    this.resources.push(
      {
        uri: 'cache://stats',
        category: 'cache',
        description: 'Cache performance metrics',
      },
      {
        uri: 'cache://deduplication',
        category: 'cache',
        description: 'Request deduplication stats',
      }
    );

    // Metrics resources (6) - dynamic runtime data, no field validation
    this.resources.push(
      {
        uri: 'metrics://summary',
        category: 'metrics',
        description: 'Comprehensive metrics',
      },
      {
        uri: 'metrics://operations',
        category: 'metrics',
        description: 'Operation performance',
      },
      {
        uri: 'metrics://cache',
        category: 'metrics',
        description: 'Cache statistics',
      },
      {
        uri: 'metrics://api',
        category: 'metrics',
        description: 'API call statistics',
      },
      {
        uri: 'metrics://system',
        category: 'metrics',
        description: 'System resources',
      },
      {
        uri: 'metrics://service',
        category: 'metrics',
        description: 'Service metadata',
      }
    );

    // Feature resources (12 total: 6 features × 2 each)
    const features = ['transaction', 'conflict', 'impact', 'validation', 'confirm', 'analyze'];

    for (const feature of features) {
      this.resources.push(
        {
          uri: `${feature}://stats`,
          category: feature,
          description: `${feature} statistics`,
          // No expectedFields - dynamic runtime data
        },
        {
          uri: `${feature}://help`,
          category: feature,
          description: `${feature} documentation`,
          // Help endpoints have structured content - validation can remain
        }
      );
    }

    // Note: chart://, pivot://, quality:// resources do not exist in the actual implementation
    // They were removed as they are not registered in src/server.ts
  }

  /**
   * Test a single resource
   */
  async testResource(
    client: any,
    logger: TestLogger,
    resource: ResourceTest
  ): Promise<ResourceTestResult> {
    const startTime = Date.now();
    const requestId = `resource-${Date.now()}`;

    logger.info(requestId, 'resource', resource.category, 'start', `Testing: ${resource.uri}`);

    try {
      // Send resources/read request
      const response = await client.send('resources/read', {
        uri: resource.uri,
      });

      const duration = Date.now() - startTime;

      // Validate response
      const accessible = !response.error && response.result;
      let contentValid = false;
      let hasMetadata = false;
      let contentSize = 0;
      let mimeType: string | undefined;

      if (accessible && response.result) {
        const result = response.result;

        // Check for content
        if (result.contents && Array.isArray(result.contents)) {
          contentValid = result.contents.length > 0;

          // Get content metadata
          const firstContent = result.contents[0];
          if (firstContent) {
            mimeType = firstContent.mimeType;
            contentSize = firstContent.text?.length || firstContent.blob?.length || 0;
          }
        }

        // Check for metadata
        hasMetadata = Boolean(result.metadata || result.meta);

        // Validate expected fields if specified
        if (resource.expectedFields && result.contents?.[0]?.text) {
          try {
            const content = JSON.parse(result.contents[0].text);
            const hasAllFields = resource.expectedFields.every((field) => field in content);
            contentValid = contentValid && hasAllFields;
          } catch {
            // Not JSON, that's ok for some resources
          }
        }
      }

      const status: 'pass' | 'fail' = accessible && contentValid ? 'pass' : 'fail';

      logger.info(
        requestId,
        'resource',
        resource.category,
        'complete',
        `${status}: ${resource.uri}`,
        {
          accessible,
          contentValid,
          hasMetadata,
          contentSize,
          mimeType,
          duration,
        }
      );

      return {
        uri: resource.uri,
        status,
        accessible,
        contentValid,
        hasMetadata,
        contentSize,
        mimeType,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        requestId,
        'resource',
        resource.category,
        'error',
        `Failed: ${resource.uri}`,
        error
      );

      return {
        uri: resource.uri,
        status: 'fail',
        accessible: false,
        contentValid: false,
        hasMetadata: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Test all resources
   */
  async testAllResources(
    client: any,
    logger: TestLogger,
    db: TestDatabase
  ): Promise<Map<string, ResourceTestResult>> {
    const results = new Map<string, ResourceTestResult>();

    console.log(`\n🔍 Testing ${this.resources.length} resources...\n`);

    for (const resource of this.resources) {
      const result = await this.testResource(client, logger, resource);
      results.set(resource.uri, result);

      // Add small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return results;
  }

  /**
   * Get resource statistics
   */
  getResourceStats(results: Map<string, ResourceTestResult>): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    byCategory: Record<string, { total: number; passed: number; failed: number }>;
  } {
    const stats = {
      total: results.size,
      passed: 0,
      failed: 0,
      skipped: 0,
      byCategory: {} as Record<string, { total: number; passed: number; failed: number }>,
    };

    for (const [uri, result] of results) {
      const category = uri.split('://')[0];

      if (!stats.byCategory[category]) {
        stats.byCategory[category] = { total: 0, passed: 0, failed: 0 };
      }

      stats.byCategory[category].total++;

      if (result.status === 'pass') {
        stats.passed++;
        stats.byCategory[category].passed++;
      } else if (result.status === 'fail') {
        stats.failed++;
        stats.byCategory[category].failed++;
      } else {
        stats.skipped++;
      }
    }

    return stats;
  }

  /**
   * Get all resources
   */
  getResources(): ResourceTest[] {
    return this.resources;
  }
}
