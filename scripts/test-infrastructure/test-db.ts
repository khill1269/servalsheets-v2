/**
 * Test Result Database
 * Stores all test results for analysis and reporting
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip' | 'auth_required';

export interface TestCase {
  id: string; // tool.action
  tool: string;
  action: string;
  status: TestStatus;
  startTime?: string;
  endTime?: string;
  duration?: number;
  request?: any;
  response?: any;
  error?: {
    code?: string;
    message: string;
    stack?: string;
    details?: any;
  };
  logs: string[]; // Log entry IDs
  retries: number;
  metadata?: {
    requiresAuth: boolean;
    requiresWritePermission: boolean;
    category: string;
  };
}

export interface TestRun {
  id: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  stats: {
    total: number;
    pending: number;
    running: number;
    pass: number;
    fail: number;
    skip: number;
    auth_required: number;
  };
  testCases: TestCase[];
}

export class TestDatabase {
  private dbPath: string;
  private testRun: TestRun;

  constructor(dbDir: string = './test-results') {
    this.dbPath = join(dbDir, `test-run-${Date.now()}.json`);

    this.testRun = {
      id: `run-${Date.now()}`,
      startTime: new Date().toISOString(),
      stats: {
        total: 0,
        pending: 0,
        running: 0,
        pass: 0,
        fail: 0,
        skip: 0,
        auth_required: 0,
      },
      testCases: [],
    };

    this.save();
  }

  /**
   * Add a test case
   */
  addTestCase(testCase: Omit<TestCase, 'logs' | 'retries' | 'status'>): TestCase {
    const fullTestCase: TestCase = {
      ...testCase,
      status: 'pending',
      logs: [],
      retries: 0,
    };

    this.testRun.testCases.push(fullTestCase);
    this.updateStats();
    this.save();

    return fullTestCase;
  }

  /**
   * Update test case status
   */
  updateTestCase(id: string, updates: Partial<TestCase>): void {
    const testCase = this.testRun.testCases.find((tc) => tc.id === id);
    if (!testCase) {
      throw new Error(`Test case not found: ${id}`);
    }

    Object.assign(testCase, updates);

    // Calculate duration if both times are set
    if (testCase.startTime && testCase.endTime) {
      testCase.duration =
        new Date(testCase.endTime).getTime() - new Date(testCase.startTime).getTime();
    }

    this.updateStats();
    this.save();
  }

  /**
   * Mark test as running
   */
  startTest(id: string, request?: any): void {
    this.updateTestCase(id, {
      status: 'running',
      startTime: new Date().toISOString(),
      request,
    });
  }

  /**
   * Mark test as passed
   */
  passTest(id: string, response?: any): void {
    this.updateTestCase(id, {
      status: 'pass',
      endTime: new Date().toISOString(),
      response,
    });
  }

  /**
   * Mark test as failed
   */
  failTest(id: string, error: any): void {
    this.updateTestCase(id, {
      status: 'fail',
      endTime: new Date().toISOString(),
      error: {
        code: error?.code,
        message: error?.message || String(error),
        stack: error?.stack,
        details: error,
      },
    });
  }

  /**
   * Mark test as skipped
   */
  skipTest(id: string, reason: string): void {
    this.updateTestCase(id, {
      status: 'skip',
      endTime: new Date().toISOString(),
      error: { message: reason },
    });
  }

  /**
   * Mark test as requiring auth
   */
  authRequiredTest(id: string, message: string): void {
    this.updateTestCase(id, {
      status: 'auth_required',
      endTime: new Date().toISOString(),
      error: { message },
    });
  }

  /**
   * Add log entry ID to test case
   */
  addLog(id: string, logId: string): void {
    const testCase = this.testRun.testCases.find((tc) => tc.id === id);
    if (testCase) {
      testCase.logs.push(logId);
      this.save();
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    this.testRun.stats = {
      total: this.testRun.testCases.length,
      pending: this.testRun.testCases.filter((tc) => tc.status === 'pending').length,
      running: this.testRun.testCases.filter((tc) => tc.status === 'running').length,
      pass: this.testRun.testCases.filter((tc) => tc.status === 'pass').length,
      fail: this.testRun.testCases.filter((tc) => tc.status === 'fail').length,
      skip: this.testRun.testCases.filter((tc) => tc.status === 'skip').length,
      auth_required: this.testRun.testCases.filter((tc) => tc.status === 'auth_required').length,
    };
  }

  /**
   * Complete test run
   */
  complete(): void {
    this.testRun.endTime = new Date().toISOString();
    this.testRun.duration =
      new Date(this.testRun.endTime).getTime() - new Date(this.testRun.startTime).getTime();
    this.save();
  }

  /**
   * Get test case by ID
   */
  getTestCase(id: string): TestCase | undefined {
    return this.testRun.testCases.find((tc) => tc.id === id);
  }

  /**
   * Get all test cases
   */
  getTestCases(): TestCase[] {
    return [...this.testRun.testCases];
  }

  /**
   * Get test cases by status
   */
  getTestCasesByStatus(status: TestStatus): TestCase[] {
    return this.testRun.testCases.filter((tc) => tc.status === status);
  }

  /**
   * Get test cases by tool
   */
  getTestCasesByTool(tool: string): TestCase[] {
    return this.testRun.testCases.filter((tc) => tc.tool === tool);
  }

  /**
   * Get statistics
   */
  getStats(): TestRun['stats'] {
    return { ...this.testRun.stats };
  }

  /**
   * Get full test run data
   */
  getTestRun(): TestRun {
    return { ...this.testRun };
  }

  /**
   * Save to disk
   */
  private save(): void {
    writeFileSync(this.dbPath, JSON.stringify(this.testRun, null, 2));
  }

  /**
   * Load from disk
   */
  static load(dbPath: string): TestDatabase {
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found: ${dbPath}`);
    }

    const data = JSON.parse(readFileSync(dbPath, 'utf-8'));
    const db = Object.create(TestDatabase.prototype);
    db.dbPath = dbPath;
    db.testRun = data;
    return db;
  }

  /**
   * Get database path
   */
  getPath(): string {
    return this.dbPath;
  }
}
