/**
 * Replay Engine
 *
 * Replays recorded requests with timing preservation and response comparison.
 * Supports 1x, 10x, and max speed replay modes.
 */

import { getRequestRecorder, type RecordedRequest } from './request-recorder.js';
import { logger } from '../utils/logger.js';
import type { ResponseDiff } from '../utils/response-diff.js';
import { NotFoundError } from '../core/errors.js';
import { diffResponses } from '../utils/response-diff.js';

/**
 * Replay mode for timing control
 */
export type ReplayMode = 'realtime' | '10x' | 'max';

/**
 * Replay result for a single request
 */
export interface ReplayResult {
  requestId: number;
  originalRequest: RecordedRequest;
  replayedAt: number;
  success: boolean;
  actualResponse: unknown;
  originalResponse: unknown;
  actualDuration: number;
  originalDuration: number;
  diff: ResponseDiff | null;
  error: string | null;
}

/**
 * Replay batch result
 */
export interface ReplayBatchResult {
  totalRequests: number;
  successfulReplays: number;
  failedReplays: number;
  results: ReplayResult[];
  startedAt: number;
  completedAt: number;
  totalDuration: number;
}

/**
 * Replay callback for progress updates
 */
export type ReplayCallback = (result: ReplayResult, index: number, total: number) => void;

/**
 * Replay Engine
 *
 * Replays recorded requests with configurable timing and comparison
 */
export class ReplayEngine {
  private recorder = getRequestRecorder();
  private toolExecutor: ToolExecutor | null = null;

  constructor(toolExecutor?: ToolExecutor) {
    this.toolExecutor = toolExecutor || null;
  }

  /**
   * Set the tool executor for replaying requests
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * Replay a single request by ID
   */
  async replaySingle(requestId: number, mode: ReplayMode = 'realtime'): Promise<ReplayResult> {
    const originalRequest = this.recorder.getById(requestId);
    if (!originalRequest) {
      throw new NotFoundError('request', String(requestId));
    }

    return this.replayRequest(originalRequest, mode);
  }

  /**
   * Replay multiple requests with timing preservation
   */
  async replayBatch(
    requestIds: number[],
    mode: ReplayMode = 'realtime',
    onProgress?: ReplayCallback
  ): Promise<ReplayBatchResult> {
    const startedAt = Date.now();
    const results: ReplayResult[] = [];

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < requestIds.length; i++) {
      const requestId = requestIds[i];
      if (requestId === undefined) continue;

      try {
        const result = await this.replaySingle(requestId, mode);
        results.push(result);

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }

        if (onProgress) {
          onProgress(result, i + 1, requestIds.length);
        }

        // Apply timing delay for next request (except in max mode)
        const nextId = requestIds[i + 1];
        if (mode !== 'max' && i < requestIds.length - 1 && nextId !== undefined) {
          const currentRequest = this.recorder.getById(requestId);
          const nextRequest = this.recorder.getById(nextId);

          if (currentRequest && nextRequest) {
            const gap =
              nextRequest.timestamp - (currentRequest.timestamp + currentRequest.duration_ms);
            if (gap > 0) {
              const adjustedGap = mode === '10x' ? gap / 10 : gap;
              await this.sleep(adjustedGap);
            }
          }
        }
      } catch (error) {
        failCount++;
        logger.error('Replay failed', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const completedAt = Date.now();

    return {
      totalRequests: requestIds.length,
      successfulReplays: successCount,
      failedReplays: failCount,
      results,
      startedAt,
      completedAt,
      totalDuration: completedAt - startedAt,
    };
  }

  /**
   * Replay a single request and compare results
   */
  private async replayRequest(
    originalRequest: RecordedRequest,
    _mode: ReplayMode
  ): Promise<ReplayResult> {
    const replayedAt = Date.now();

    if (!this.toolExecutor) {
      return {
        requestId: originalRequest.id!,
        originalRequest,
        replayedAt,
        success: false,
        actualResponse: null,
        originalResponse: JSON.parse(originalRequest.response_body),
        actualDuration: 0,
        originalDuration: originalRequest.duration_ms,
        diff: null,
        error: 'No tool executor configured',
      };
    }

    const parsedRequest = JSON.parse(originalRequest.request_body);
    const originalResponse = JSON.parse(originalRequest.response_body);

    try {
      const startTime = Date.now();

      // Execute the tool with the recorded request
      const actualResponse = await this.toolExecutor.execute(
        originalRequest.tool_name,
        parsedRequest
      );

      const actualDuration = Date.now() - startTime;

      // Compare responses
      const diff = diffResponses(originalResponse, actualResponse);

      return {
        requestId: originalRequest.id!,
        originalRequest,
        replayedAt,
        success: true,
        actualResponse,
        originalResponse,
        actualDuration,
        originalDuration: originalRequest.duration_ms,
        diff,
        error: null,
      };
    } catch (error) {
      return {
        requestId: originalRequest.id!,
        originalRequest,
        replayedAt,
        success: false,
        actualResponse: null,
        originalResponse,
        actualDuration: 0,
        originalDuration: originalRequest.duration_ms,
        diff: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get timing statistics for a batch of requests
   */
  getTimingStats(requestIds: number[]): {
    totalDuration: number;
    avgGap: number;
    minGap: number;
    maxGap: number;
    estimatedReplayTime: {
      realtime: number;
      '10x': number;
      max: number;
    };
  } {
    const requests = requestIds
      .map((id) => this.recorder.getById(id))
      .filter((r): r is RecordedRequest => r !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (requests.length === 0) {
      return {
        totalDuration: 0,
        avgGap: 0,
        minGap: 0,
        maxGap: 0,
        estimatedReplayTime: { realtime: 0, '10x': 0, max: 0 },
      };
    }

    const totalDuration = requests.reduce((sum, r) => sum + r.duration_ms, 0);
    const gaps: number[] = [];

    for (let i = 0; i < requests.length - 1; i++) {
      const currentReq = requests[i];
      const nextReq = requests[i + 1];
      if (currentReq && nextReq) {
        const gap = nextReq.timestamp - (currentReq.timestamp + currentReq.duration_ms);
        gaps.push(Math.max(0, gap));
      }
    }

    const avgGap = gaps.length > 0 ? gaps.reduce((sum, g) => sum + g, 0) / gaps.length : 0;
    const minGap = gaps.length > 0 ? Math.min(...gaps) : 0;
    const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;

    const totalGaps = gaps.reduce((sum, g) => sum + g, 0);
    const realtime = totalDuration + totalGaps;
    const tenX = totalDuration + totalGaps / 10;
    const max = totalDuration; // No gaps

    return {
      totalDuration,
      avgGap,
      minGap,
      maxGap,
      estimatedReplayTime: {
        realtime,
        '10x': tenX,
        max,
      },
    };
  }
}

/**
 * Tool executor interface
 * Must be implemented to replay requests against actual MCP tools
 */
export interface ToolExecutor {
  /**
   * Execute a tool with the given request
   * @returns Tool response
   */
  execute(toolName: string, request: unknown): Promise<unknown>;
}

/**
 * Create a replay engine with optional tool executor
 */
export function createReplayEngine(executor?: ToolExecutor): ReplayEngine {
  return new ReplayEngine(executor);
}
