#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Request Replay CLI Tool
 *
 * Command-line interface for replaying recorded MCP requests
 */

import { Command } from 'commander';
import { ConfigError, NotFoundError } from '../core/errors.js';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getRequestRecorder, type RecordFilter } from '../services/request-recorder.js';
import {
  createReplayEngine,
  type ReplayMode,
  type ToolExecutor,
} from '../services/replay-engine.js';
import { formatDiffReport } from '../utils/response-diff.js';
import { createHandlers, type HandlerContext } from '../handlers/index.js';
import { createGoogleApiClient } from '../services/google-api.js';

const program = new Command();

program.name('replay').description('Replay recorded MCP requests for debugging').version('1.0.0');

/**
 * List recorded requests
 */
program
  .command('list')
  .description('List recorded requests')
  .option('-t, --tool <tool>', 'Filter by tool name')
  .option('-a, --action <action>', 'Filter by action')
  .option('-s, --spreadsheet <id>', 'Filter by spreadsheet ID')
  .option('-e, --errors', 'Show only failed requests')
  .option('-l, --limit <n>', 'Limit number of results', '50')
  .action(async (options) => {
    const recorder = getRequestRecorder();

    const filter: RecordFilter = {
      tool_name: options.tool,
      action: options.action,
      spreadsheet_id: options.spreadsheet,
      has_error: options.errors,
      limit: parseInt(options.limit, 10),
    };

    const requests = recorder.query(filter);

    if (requests.length === 0) {
      console.log(chalk.yellow('No requests found matching filter'));
      return;
    }

    const table = new Table({
      head: ['ID', 'Tool', 'Action', 'Spreadsheet', 'Status', 'Duration', 'Timestamp'].map((h) =>
        chalk.cyan(h)
      ),
      colWidths: [8, 20, 20, 25, 10, 12, 20],
    });

    requests.forEach((req) => {
      const statusIcon = req.status_code === 200 ? chalk.green('✓') : chalk.red('✗');
      const timestamp = new Date(req.timestamp).toLocaleString();

      table.push([
        req.id!.toString(),
        req.tool_name,
        req.action,
        req.spreadsheet_id || '-',
        `${statusIcon} ${req.status_code}`,
        `${req.duration_ms}ms`,
        timestamp,
      ]);
    });

    console.log(table.toString());
    console.log(chalk.gray(`\nShowing ${requests.length} request(s)`));
  });

/**
 * Show request details
 */
program
  .command('show <id>')
  .description('Show detailed information about a recorded request')
  .action(async (id: string) => {
    const recorder = getRequestRecorder();
    const request = recorder.getById(parseInt(id, 10));

    if (!request) {
      console.error(chalk.red(`Request ${id} not found`));
      process.exit(1);
    }

    console.log(chalk.cyan('\n=== Request Details ===\n'));
    console.log(chalk.bold('ID:'), request.id);
    console.log(chalk.bold('Tool:'), request.tool_name);
    console.log(chalk.bold('Action:'), request.action);
    console.log(chalk.bold('Spreadsheet:'), request.spreadsheet_id || 'N/A');
    console.log(
      chalk.bold('Status:'),
      request.status_code === 200
        ? chalk.green(request.status_code)
        : chalk.red(request.status_code)
    );
    console.log(chalk.bold('Duration:'), `${request.duration_ms}ms`);
    console.log(chalk.bold('Timestamp:'), new Date(request.timestamp).toLocaleString());

    if (request.error_message) {
      console.log(chalk.bold('Error:'), chalk.red(request.error_message));
    }

    console.log(chalk.cyan('\n--- Request Body ---\n'));
    const requestBody = JSON.parse(request.request_body);
    console.log(JSON.stringify(requestBody, null, 2));

    console.log(chalk.cyan('\n--- Response Body ---\n'));
    const responseBody = JSON.parse(request.response_body);
    console.log(JSON.stringify(responseBody, null, 2));
  });

/**
 * Replay a single request
 */
program
  .command('run <id>')
  .description('Replay a single request')
  .option('-m, --mode <mode>', 'Replay mode: realtime, 10x, max', 'max')
  .option('--no-compare', 'Skip response comparison')
  .action(async (id: string, options) => {
    const requestId = parseInt(id, 10);
    const mode = options.mode as ReplayMode;

    console.log(chalk.cyan(`\nReplaying request ${id} in ${mode} mode...\n`));

    try {
      const executor = await createToolExecutorFromEnv();
      const engine = createReplayEngine(executor);

      const result = await engine.replaySingle(requestId, mode);

      if (result.success) {
        console.log(chalk.green('✓ Replay successful'));
        console.log(
          chalk.gray(
            `Duration: ${result.actualDuration}ms (original: ${result.originalDuration}ms)`
          )
        );

        if (options.compare && result.diff) {
          console.log(chalk.cyan('\n--- Response Comparison ---\n'));
          console.log(formatDiffReport(result.diff));
        }
      } else {
        console.log(chalk.red('✗ Replay failed'));
        console.log(chalk.red(`Error: ${result.error}`));
      }
    } catch (error) {
      console.error(
        chalk.red('Replay error:'),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

/**
 * Replay batch of requests
 */
program
  .command('batch')
  .description('Replay a batch of requests')
  .option('-t, --tool <tool>', 'Filter by tool name')
  .option('-a, --action <action>', 'Filter by action')
  .option('-s, --spreadsheet <id>', 'Filter by spreadsheet ID')
  .option('-l, --limit <n>', 'Limit number of requests', '10')
  .option('-m, --mode <mode>', 'Replay mode: realtime, 10x, max', 'max')
  .action(async (options) => {
    const recorder = getRequestRecorder();

    const filter: RecordFilter = {
      tool_name: options.tool,
      action: options.action,
      spreadsheet_id: options.spreadsheet,
      limit: parseInt(options.limit, 10),
    };

    const requests = recorder.query(filter);

    if (requests.length === 0) {
      console.log(chalk.yellow('No requests found matching filter'));
      return;
    }

    const requestIds = requests.map((r) => r.id!);

    console.log(
      chalk.cyan(`\nReplaying ${requestIds.length} request(s) in ${options.mode} mode...\n`)
    );

    try {
      const executor = await createToolExecutorFromEnv();
      const engine = createReplayEngine(executor);

      const batchResult = await engine.replayBatch(
        requestIds,
        options.mode as ReplayMode,
        (result, index, total) => {
          const icon = result.success ? chalk.green('✓') : chalk.red('✗');
          console.log(
            `${icon} [${index}/${total}] Request ${result.requestId} - ${result.originalRequest.tool_name}.${result.originalRequest.action}`
          );
        }
      );

      console.log(chalk.cyan('\n=== Batch Replay Summary ===\n'));
      console.log(chalk.bold('Total:'), batchResult.totalRequests);
      console.log(chalk.bold('Success:'), chalk.green(batchResult.successfulReplays));
      console.log(chalk.bold('Failed:'), chalk.red(batchResult.failedReplays));
      console.log(chalk.bold('Duration:'), `${batchResult.totalDuration}ms`);
    } catch (error) {
      console.error(
        chalk.red('Batch replay error:'),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

/**
 * Show statistics
 */
program
  .command('stats')
  .description('Show statistics about recorded requests')
  .action(async () => {
    const recorder = getRequestRecorder();
    const stats = recorder.getStats();

    console.log(chalk.cyan('\n=== Request Statistics ===\n'));
    console.log(chalk.bold('Total Requests:'), stats.total);
    console.log(chalk.bold('Errors:'), chalk.red(stats.errors));

    if (stats.date_range) {
      console.log(chalk.bold('Date Range:'));
      console.log(`  Earliest: ${new Date(stats.date_range.earliest).toLocaleString()}`);
      console.log(`  Latest: ${new Date(stats.date_range.latest).toLocaleString()}`);
    }

    console.log(chalk.cyan('\n--- By Tool ---\n'));
    Object.entries(stats.by_tool)
      .sort((a, b) => b[1] - a[1])
      .forEach(([tool, count]) => {
        console.log(`  ${tool}: ${count}`);
      });

    console.log(chalk.cyan('\n--- By Status Code ---\n'));
    Object.entries(stats.by_status)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .forEach(([status, count]) => {
        const icon = status === '200' ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon} ${status}: ${count}`);
      });
  });

/**
 * Cleanup old requests
 */
program
  .command('cleanup')
  .description('Delete old recorded requests')
  .option('-d, --days <n>', 'Delete requests older than N days', '30')
  .action(async (options) => {
    const recorder = getRequestRecorder();
    const days = parseInt(options.days, 10);
    const olderThanMs = days * 24 * 60 * 60 * 1000;

    console.log(chalk.yellow(`\nDeleting requests older than ${days} day(s)...\n`));

    const deleted = recorder.cleanup(olderThanMs);

    console.log(chalk.green(`✓ Deleted ${deleted} request(s)`));
  });

/**
 * Create a tool executor from environment
 */
async function createToolExecutorFromEnv(): Promise<ToolExecutor> {
  const accessToken = process.env['GOOGLE_ACCESS_TOKEN'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];

  if (!accessToken) {
    throw new ConfigError(
      'GOOGLE_ACCESS_TOKEN environment variable is required for replay',
      'GOOGLE_ACCESS_TOKEN'
    );
  }

  const googleClient = await createGoogleApiClient({
    accessToken,
    refreshToken,
  });

  // Replay tool doesn't use the batch/caching/merging infrastructure — cast is intentional
  const context = {
    googleClient,
    auth: {
      hasElevatedAccess: googleClient.hasElevatedAccess,
      scopes: googleClient.scopes,
    },
  } as unknown as HandlerContext;

  const handlers = createHandlers({
    context,
    sheetsApi: googleClient.sheets,
    driveApi: googleClient.drive,
  });

  return {
    async execute(toolName: string, request: unknown): Promise<unknown> {
      const handler = (
        handlers as unknown as Record<
          string,
          { executeAction: (input: unknown) => Promise<unknown> }
        >
      )[toolName.replace('sheets_', '')];
      if (!handler) {
        throw new NotFoundError('tool_handler', toolName);
      }

      return handler.executeAction(request);
    },
  };
}

// Parse and execute
program.parse(process.argv);

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
