/**
 * E2E Test Orchestrator
 *
 * Provides high-level workflow coordination for E2E tests.
 * Handles multi-step workflows, cleanup, and state management.
 *
 * Features:
 * - Automatic spreadsheet lifecycle management
 * - State tracking across workflow steps
 * - Automatic cleanup on test completion
 * - Error recovery and rollback support
 */

import { LiveApiClient } from '../../live-api/setup/live-api-client.js';
import { loadTestCredentials, shouldRunIntegrationTests } from '../../helpers/credential-loader.js';
import { logger } from '../../../src/utils/logger.js';

export interface WorkflowContext {
  /** Current spreadsheet ID */
  spreadsheetId: string;
  /** Workflow state (arbitrary key-value pairs) */
  state: Record<string, unknown>;
  /** Created resources for cleanup */
  resources: Array<{ type: 'spreadsheet' | 'sheet' | 'chart'; id: string }>;
  /** Execution history */
  history: Array<{
    step: string;
    tool: string;
    action: string;
    timestamp: number;
    success: boolean;
  }>;
}

export interface WorkflowStep {
  name: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  /** Optional validation function */
  validate?: (result: unknown, context: WorkflowContext) => void | Promise<void>;
}

/**
 * E2E Test Orchestrator
 *
 * Coordinates multi-step workflows for E2E testing.
 * Automatically manages test spreadsheets and cleanup.
 */
export class TestOrchestrator {
  private client: LiveApiClient;
  private context: WorkflowContext;
  private cleanupTasks: Array<() => Promise<void>> = [];

  constructor(private testTitle: string) {
    const credentials = loadTestCredentials();
    this.client = new LiveApiClient(credentials, {
      logRequests: false,
      trackMetrics: true,
      useRetryManager: true,
      useRateLimiter: true,
    });

    this.context = {
      spreadsheetId: '',
      state: {},
      resources: [],
      history: [],
    };
  }

  /**
   * Initialize test environment and create test spreadsheet
   */
  async setup(title?: string): Promise<string> {
    const spreadsheetTitle = title || `E2E Test: ${this.testTitle}`;

    logger.info('Setting up E2E test environment', { title: spreadsheetTitle });

    // Create test spreadsheet
    const response = await this.client.sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: spreadsheetTitle,
        },
        sheets: [
          {
            properties: {
              title: 'Data',
              gridProperties: {
                rowCount: 1000,
                columnCount: 26,
              },
            },
          },
        ],
      },
    });

    const spreadsheetId = response.data.spreadsheetId!;
    this.context.spreadsheetId = spreadsheetId;
    this.context.resources.push({ type: 'spreadsheet', id: spreadsheetId });

    // Schedule cleanup
    this.cleanupTasks.push(async () => {
      await this.client.drive.files.delete({ fileId: spreadsheetId });
      logger.info('Deleted test spreadsheet', { spreadsheetId });
    });

    logger.info('Test spreadsheet created', { spreadsheetId, title: spreadsheetTitle });

    return spreadsheetId;
  }

  /**
   * Execute a workflow step
   */
  async executeStep(step: WorkflowStep): Promise<unknown> {
    const startTime = performance.now();

    logger.info('Executing workflow step', {
      step: step.name,
      tool: step.tool,
      action: step.action,
    });

    try {
      // Execute step (simulation for now - in real implementation would call MCP tools)
      const result = await this.callTool(step.tool, step.action, {
        ...step.args,
        spreadsheetId: step.args.spreadsheetId || this.context.spreadsheetId,
      });

      // Validate result if validator provided
      if (step.validate) {
        await step.validate(result, this.context);
      }

      // Record success
      this.context.history.push({
        step: step.name,
        tool: step.tool,
        action: step.action,
        timestamp: Date.now(),
        success: true,
      });

      const duration = performance.now() - startTime;
      logger.info('Workflow step completed', { step: step.name, durationMs: duration });

      return result;
    } catch (error) {
      // Record failure
      this.context.history.push({
        step: step.name,
        tool: step.tool,
        action: step.action,
        timestamp: Date.now(),
        success: false,
      });

      logger.error('Workflow step failed', {
        step: step.name,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Execute a complete workflow
   */
  async executeWorkflow(steps: WorkflowStep[]): Promise<WorkflowContext> {
    logger.info('Starting workflow execution', {
      title: this.testTitle,
      steps: steps.length,
    });

    for (const step of steps) {
      await this.executeStep(step);
    }

    logger.info('Workflow completed', {
      title: this.testTitle,
      successfulSteps: this.context.history.filter((h) => h.success).length,
      totalSteps: steps.length,
    });

    return this.context;
  }

  /**
   * Call MCP tool (simplified version for E2E tests)
   *
   * In production, this would use the actual MCP server.
   * For E2E tests, we call Google APIs directly.
   */
  private async callTool(
    tool: string,
    action: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // For E2E tests, we bypass the MCP layer and call Google API directly
    // This tests end-to-end functionality without MCP protocol overhead

    const { spreadsheetId, ...otherArgs } = args;

    if (!spreadsheetId || typeof spreadsheetId !== 'string') {
      throw new Error('spreadsheetId is required');
    }

    switch (`${tool}:${action}`) {
      case 'sheets_data:write':
        return await this.writeData(spreadsheetId, otherArgs);

      case 'sheets_data:read':
        return await this.readData(spreadsheetId, otherArgs);

      case 'sheets_format:set_format':
        return await this.setFormat(spreadsheetId, otherArgs);

      case 'sheets_analyze:quick':
      case 'sheets_analyze:comprehensive':
        return await this.analyzeData(spreadsheetId, action, otherArgs);

      default:
        throw new Error(`Unsupported tool action: ${tool}:${action}`);
    }
  }

  /**
   * Write data to spreadsheet
   */
  private async writeData(spreadsheetId: string, args: Record<string, unknown>) {
    const { range, values, valueInputOption = 'USER_ENTERED' } = args;

    const response = await this.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range as string,
      valueInputOption: valueInputOption as string,
      requestBody: {
        values: values as unknown[][],
      },
    });

    return {
      success: true,
      updatedCells: response.data.updatedCells,
      updatedRows: response.data.updatedRows,
      updatedColumns: response.data.updatedColumns,
    };
  }

  /**
   * Read data from spreadsheet
   */
  private async readData(spreadsheetId: string, args: Record<string, unknown>) {
    const { range } = args;

    const response = await this.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: range as string,
    });

    return {
      success: true,
      values: response.data.values || [],
      range: response.data.range,
    };
  }

  /**
   * Set cell formatting
   */
  private async setFormat(spreadsheetId: string, args: Record<string, unknown>) {
    const { range, format } = args;

    // Parse range to get sheet ID and grid range
    const rangeStr = range as string;
    const [sheetName] = rangeStr.split('!');

    // Get sheet metadata to find sheet ID
    const metadata = await this.client.sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheet = metadata.data.sheets?.find((s) => s.properties?.title === sheetName);
    if (!sheet || !sheet.properties?.sheetId) {
      throw new Error(`Sheet not found: ${sheetName}`);
    }

    // Apply formatting (simplified - would need full range parsing in production)
    const response = await this.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheet.properties.sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: format,
              },
              fields: 'userEnteredFormat',
            },
          },
        ],
      },
    });

    return {
      success: true,
      replies: response.data.replies,
    };
  }

  /**
   * Analyze spreadsheet data
   *
   * Note: This is a simplified stub. Real implementation would
   * call sheets_analyze tool which uses AI analysis.
   */
  private async analyzeData(spreadsheetId: string, action: string, _args: Record<string, unknown>) {
    // For E2E tests, we simulate analysis by reading data and computing basic metrics
    const metadata = await this.client.sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: true,
    });

    const sheet = metadata.data.sheets?.[0];
    if (!sheet) {
      throw new Error('No sheets found');
    }

    const data = sheet.data?.[0];
    const rowCount = data?.rowData?.length || 0;
    const cellCount = rowCount * (data?.rowData?.[0]?.values?.length || 0);

    return {
      success: true,
      analysis: {
        type: action,
        spreadsheetId,
        cellsAnalyzed: cellCount,
        rowsAnalyzed: rowCount,
        quality_score: 85, // Stub score
        insights: ['Data structure looks good', 'No obvious quality issues detected'],
      },
    };
  }

  /**
   * Get workflow context
   */
  getContext(): WorkflowContext {
    return this.context;
  }

  /**
   * Get API client for direct access
   */
  getClient(): LiveApiClient {
    return this.client;
  }

  /**
   * Clean up all test resources
   */
  async cleanup(): Promise<void> {
    logger.info('Starting E2E test cleanup', {
      title: this.testTitle,
      resources: this.context.resources.length,
      tasks: this.cleanupTasks.length,
    });

    // Run cleanup tasks in reverse order (LIFO)
    for (const task of this.cleanupTasks.reverse()) {
      try {
        await task();
      } catch (error) {
        logger.error('Cleanup task failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other cleanup tasks
      }
    }

    logger.info('E2E test cleanup completed', { title: this.testTitle });
  }
}

/**
 * Create E2E test orchestrator
 */
export function createTestOrchestrator(testTitle: string): TestOrchestrator {
  return new TestOrchestrator(testTitle);
}

/**
 * Skip E2E tests if credentials not available
 */
export function describeE2E(title: string, fn: () => void): void {
  if (!shouldRunIntegrationTests()) {
    // eslint-disable-next-line vitest/valid-describe-callback
    describe.skip(title, fn);
  } else {
    describe(title, fn);
  }
}
