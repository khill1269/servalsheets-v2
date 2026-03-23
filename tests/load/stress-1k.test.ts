/**
 * Load Testing Suite - 1000+ Concurrent Requests
 *
 * Tests ServalSheets performance under high concurrent load.
 * Validates that the server can handle production-level traffic.
 *
 * Test Matrix:
 * - Read operations: 1000 concurrent, 5 min
 * - Write operations: 500 concurrent, 5 min
 * - Mixed workload: 1000 concurrent, 10 min
 * - Sustained load: 100 concurrent, 60 min
 *
 * Performance Targets:
 * - Read P95: <400ms, P99: <2s
 * - Write P95: <800ms, P99: <4s
 * - Mixed P95: <600ms, P99: <3s
 * - Sustained P95: <500ms, P99: <2s
 *
 * @category Load Testing
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { waitFor } from '../helpers/wait-for.js';

// Test configuration
const TEST_CONFIG = {
  serverPort: 3010, // Use dedicated port for load testing
  rampUpSeconds: 30, // Gradual ramp-up to avoid thundering herd
  coolDownSeconds: 10, // Cool down between tests
  spreadsheetId: process.env.TEST_SPREADSHEET_ID || 'test-sheet-id',
} as const;

interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  throughput: number; // requests per second
  errorRate: number; // percentage
}

interface TestResult {
  scenario: string;
  duration: number;
  metrics: LoadTestMetrics;
  passed: boolean;
  failures: string[];
}

/**
 * HTTP Server Process Manager
 */
class ServerProcess {
  private process: ChildProcess | null = null;
  private ready = false;

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(
        'node',
        ['dist/cli.js', '--http', '--port', String(TEST_CONFIG.serverPort)],
        {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            LOG_LEVEL: 'warn', // Reduce logging overhead during load tests
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      const timeoutId = setTimeout(() => {
        reject(new Error('Server startup timeout (30s)'));
      }, 30000);

      // Wait for server ready signal
      if (this.process.stdout) {
        const rl = createInterface({ input: this.process.stdout });
        rl.on('line', (line) => {
          if (line.includes('HTTP server listening on port') || line.includes('Server ready')) {
            clearTimeout(timeoutId);
            this.ready = true;
            resolve();
          }
        });
      }

      // Handle errors
      this.process.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      this.process.stderr?.on('data', (data) => {
        const message = data.toString();
        if (message.includes('Error')) {
          console.error(`[Server Error] ${message}`);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await waitFor(2000);
      if (!this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }
    this.ready = false;
    this.process = null;
  }

  isReady(): boolean {
    return this.ready;
  }
}

/**
 * Load Test Executor
 */
class LoadTestExecutor {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  /**
   * Execute concurrent requests and collect metrics
   */
  async executeLoad(
    concurrent: number,
    duration: number,
    requestGenerator: () => Promise<{ latency: number; success: boolean }>
  ): Promise<LoadTestMetrics> {
    const startTime = Date.now();
    const latencies: number[] = [];
    let successfulRequests = 0;
    let failedRequests = 0;

    const workers: Array<Promise<void>> = [];

    for (let i = 0; i < concurrent; i++) {
      workers.push(
        (async () => {
          while (Date.now() - startTime < duration) {
            try {
              const result = await requestGenerator();
              latencies.push(result.latency);
              if (result.success) {
                successfulRequests++;
              } else {
                failedRequests++;
              }
            } catch (_error) {
              failedRequests++;
            }
          }
        })()
      );
    }

    await Promise.all(workers);

    const totalTime = (Date.now() - startTime) / 1000;
    latencies.sort((a, b) => a - b);

    return {
      totalRequests: successfulRequests + failedRequests,
      successfulRequests,
      failedRequests,
      p50Latency: this.percentile(latencies, 0.5),
      p95Latency: this.percentile(latencies, 0.95),
      p99Latency: this.percentile(latencies, 0.99),
      maxLatency: latencies[latencies.length - 1] || 0,
      throughput: (successfulRequests + failedRequests) / totalTime,
      errorRate: (failedRequests / (successfulRequests + failedRequests)) * 100,
    };
  }

  /**
   * Test read operations (sheets_data read)
   */
  async testReadOperations(concurrent: number, durationMs: number): Promise<LoadTestMetrics> {
    return this.executeLoad(concurrent, durationMs, async () => {
      const start = Date.now();
      try {
        const response = await fetch(`${this.baseUrl}/tools/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.TEST_TOKEN || 'test-token'}`,
          },
          body: JSON.stringify({
            name: 'sheets_data',
            arguments: {
              spreadsheetId: TEST_CONFIG.spreadsheetId,
              action: 'read',
              args: {
                range: 'A1:B10',
              },
            },
          }),
        });

        const latency = Date.now() - start;
        return { latency, success: response.ok };
      } catch (_error) {
        return { latency: Date.now() - start, success: false };
      }
    });
  }

  /**
   * Test write operations (sheets_data write)
   */
  async testWriteOperations(concurrent: number, durationMs: number): Promise<LoadTestMetrics> {
    return this.executeLoad(concurrent, durationMs, async () => {
      const start = Date.now();
      try {
        const response = await fetch(`${this.baseUrl}/tools/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.TEST_TOKEN || 'test-token'}`,
          },
          body: JSON.stringify({
            name: 'sheets_data',
            arguments: {
              spreadsheetId: TEST_CONFIG.spreadsheetId,
              action: 'write',
              args: {
                range: 'Test!A1',
                values: [[`Load test ${Date.now()}`]],
              },
            },
          }),
        });

        const latency = Date.now() - start;
        return { latency, success: response.ok };
      } catch (_error) {
        return { latency: Date.now() - start, success: false };
      }
    });
  }

  /**
   * Test mixed workload (70% reads, 30% writes)
   */
  async testMixedWorkload(concurrent: number, durationMs: number): Promise<LoadTestMetrics> {
    return this.executeLoad(concurrent, durationMs, async () => {
      const isRead = Math.random() < 0.7;
      const start = Date.now();

      try {
        const response = await fetch(`${this.baseUrl}/tools/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.TEST_TOKEN || 'test-token'}`,
          },
          body: JSON.stringify({
            name: 'sheets_data',
            arguments: {
              spreadsheetId: TEST_CONFIG.spreadsheetId,
              action: isRead ? 'read' : 'write',
              args: isRead
                ? { range: 'A1:B10' }
                : { range: 'Test!A1', values: [[`Load ${Date.now()}`]] },
            },
          }),
        });

        const latency = Date.now() - start;
        return { latency, success: response.ok };
      } catch (_error) {
        return { latency: Date.now() - start, success: false };
      }
    });
  }

  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))]!;
  }
}

/**
 * Test Suite
 */
// Load tests require a real server — skip when not in CI with full infra
const ENABLE_LOAD = process.env.LOAD_TEST === 'true';

describe.skipIf(!ENABLE_LOAD)('Load Testing - 1000+ Concurrent Requests', () => {
  let server: ServerProcess;
  let executor: LoadTestExecutor;
  const results: TestResult[] = [];

  beforeAll(async () => {
    server = new ServerProcess();
    executor = new LoadTestExecutor(TEST_CONFIG.serverPort);

    console.log('\n🚀 Starting HTTP server for load testing...');
    await server.start();
    await waitFor(3000); // Additional warm-up time
    console.log('✅ Server ready\n');
  }, 60000);

  afterAll(async () => {
    console.log('\n📊 Load Test Results Summary:\n');
    for (const result of results) {
      console.log(`${result.passed ? '✅' : '❌'} ${result.scenario}`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
      console.log(`   Total Requests: ${result.metrics.totalRequests}`);
      console.log(`   Success Rate: ${(100 - result.metrics.errorRate).toFixed(2)}%`);
      console.log(`   Throughput: ${result.metrics.throughput.toFixed(1)} req/s`);
      console.log(`   P50: ${result.metrics.p50Latency}ms`);
      console.log(`   P95: ${result.metrics.p95Latency}ms`);
      console.log(`   P99: ${result.metrics.p99Latency}ms`);
      if (result.failures.length > 0) {
        console.log(`   Failures: ${result.failures.join(', ')}`);
      }
      console.log('');
    }

    await server.stop();
  }, 30000);

  it(
    'should handle 1000 concurrent read operations (5 min)',
    async () => {
      console.log('📖 Testing 1000 concurrent read operations...');
      const start = Date.now();

      const metrics = await executor.testReadOperations(1000, 5 * 60 * 1000);

      const duration = Date.now() - start;
      const failures: string[] = [];

      // Validate performance targets
      if (metrics.p95Latency > 400) {
        failures.push(`P95 latency ${metrics.p95Latency}ms > 400ms target`);
      }
      if (metrics.p99Latency > 2000) {
        failures.push(`P99 latency ${metrics.p99Latency}ms > 2000ms target`);
      }
      if (metrics.errorRate > 5) {
        failures.push(`Error rate ${metrics.errorRate.toFixed(2)}% > 5% threshold`);
      }

      const passed = failures.length === 0;
      results.push({
        scenario: 'Read Operations (1000 concurrent)',
        duration,
        metrics,
        passed,
        failures,
      });

      expect(failures).toHaveLength(0);
    },
    6 * 60 * 1000 // 6 min timeout
  );

  it(
    'should handle 500 concurrent write operations (5 min)',
    async () => {
      console.log('✍️  Testing 500 concurrent write operations...');
      await waitFor(TEST_CONFIG.coolDownSeconds * 1000);

      const start = Date.now();
      const metrics = await executor.testWriteOperations(500, 5 * 60 * 1000);

      const duration = Date.now() - start;
      const failures: string[] = [];

      if (metrics.p95Latency > 800) {
        failures.push(`P95 latency ${metrics.p95Latency}ms > 800ms target`);
      }
      if (metrics.p99Latency > 4000) {
        failures.push(`P99 latency ${metrics.p99Latency}ms > 4000ms target`);
      }
      if (metrics.errorRate > 5) {
        failures.push(`Error rate ${metrics.errorRate.toFixed(2)}% > 5% threshold`);
      }

      const passed = failures.length === 0;
      results.push({
        scenario: 'Write Operations (500 concurrent)',
        duration,
        metrics,
        passed,
        failures,
      });

      expect(failures).toHaveLength(0);
    },
    6 * 60 * 1000
  );

  it(
    'should handle 1000 concurrent mixed workload (10 min)',
    async () => {
      console.log('🔀 Testing 1000 concurrent mixed operations...');
      await waitFor(TEST_CONFIG.coolDownSeconds * 1000);

      const start = Date.now();
      const metrics = await executor.testMixedWorkload(1000, 10 * 60 * 1000);

      const duration = Date.now() - start;
      const failures: string[] = [];

      if (metrics.p95Latency > 600) {
        failures.push(`P95 latency ${metrics.p95Latency}ms > 600ms target`);
      }
      if (metrics.p99Latency > 3000) {
        failures.push(`P99 latency ${metrics.p99Latency}ms > 3000ms target`);
      }
      if (metrics.errorRate > 5) {
        failures.push(`Error rate ${metrics.errorRate.toFixed(2)}% > 5% threshold`);
      }

      const passed = failures.length === 0;
      results.push({
        scenario: 'Mixed Workload (1000 concurrent)',
        duration,
        metrics,
        passed,
        failures,
      });

      expect(failures).toHaveLength(0);
    },
    11 * 60 * 1000
  );

  it(
    'should sustain 100 concurrent requests for 60 minutes',
    async () => {
      console.log('⏱️  Testing sustained load (100 concurrent, 60 min)...');
      await waitFor(TEST_CONFIG.coolDownSeconds * 1000);

      const start = Date.now();
      const metrics = await executor.testMixedWorkload(100, 60 * 60 * 1000);

      const duration = Date.now() - start;
      const failures: string[] = [];

      if (metrics.p95Latency > 500) {
        failures.push(`P95 latency ${metrics.p95Latency}ms > 500ms target`);
      }
      if (metrics.p99Latency > 2000) {
        failures.push(`P99 latency ${metrics.p99Latency}ms > 2000ms target`);
      }
      if (metrics.errorRate > 2) {
        failures.push(
          `Error rate ${metrics.errorRate.toFixed(2)}% > 2% threshold (sustained load)`
        );
      }

      const passed = failures.length === 0;
      results.push({
        scenario: 'Sustained Load (100 concurrent)',
        duration,
        metrics,
        passed,
        failures,
      });

      expect(failures).toHaveLength(0);
    },
    65 * 60 * 1000
  );
});
