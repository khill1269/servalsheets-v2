/**
 * Tracing UI integration for HTTP server
 * Serves the React dashboard and SSE streaming endpoint
 */

import type { Express, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTraceAggregator } from './services/trace-aggregator.js';
import { resolveTracingDashboardPath } from './utils/runtime-paths.js';
import { logger } from './utils/logger.js';

function sendTracingUiUnavailable(res: Response): void {
  res.status(500).json({
    error: {
      code: 'UI_LOAD_FAILED',
      message: 'Failed to load tracing UI. Run `npm run build:ui` to build the dashboard.',
    },
  });
}

/**
 * Add tracing UI routes to Express app
 */
export function addTracingUIRoutes(app: Express): void {
  const dashboardPath = resolveTracingDashboardPath();

  // Serve static assets
  app.get('/ui/tracing/assets/*', (req: Request, res: Response) => {
    if (!dashboardPath) {
      sendTracingUiUnavailable(res);
      return;
    }

    const assetPath = req.path.replace('/ui/tracing/', '');
    res.sendFile(assetPath, { root: dashboardPath }, (error) => {
      if (!error) {
        return;
      }

      logger.error('Failed to serve tracing UI asset', { assetPath, error });
      if (!res.headersSent) {
        res.status(404).send('Asset not found');
      }
    });
  });

  // Serve main HTML
  app.get('/ui/tracing', (_req: Request, res: Response) => {
    if (!dashboardPath) {
      sendTracingUiUnavailable(res);
      return;
    }

    try {
      const html = readFileSync(join(dashboardPath, 'index.html'), 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      logger.error('Failed to serve tracing UI', { error });
      sendTracingUiUnavailable(res);
    }
  });

  // SSE streaming endpoint for live traces
  app.get('/traces/stream', (req: Request, res: Response) => {
    const aggregator = getTraceAggregator();

    if (!aggregator.isEnabled()) {
      res.status(503).json({
        error: {
          code: 'SERVICE_DISABLED',
          message: 'Trace aggregation is not enabled. Set TRACE_AGGREGATION_ENABLED=true',
        },
      });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    logger.info('SSE client connected to trace stream', {
      clientId: req.ip,
    });

    // Send heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    // Track recent traces sent to avoid duplicates
    const sentTraceIds = new Set<string>();

    // Poll for new traces every 1s
    const pollInterval = setInterval(() => {
      const recentTraces = aggregator.getRecentTraces(10);

      for (const trace of recentTraces) {
        if (!sentTraceIds.has(trace.requestId)) {
          sentTraceIds.add(trace.requestId);
          res.write(`data: ${JSON.stringify(trace)}\n\n`);

          // Limit set size to prevent memory leak
          if (sentTraceIds.size > 1000) {
            const oldest = Array.from(sentTraceIds)[0];
            if (oldest) {
              sentTraceIds.delete(oldest);
            }
          }
        }
      }
    }, 1000);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(pollInterval);
      sentTraceIds.clear();
      logger.info('SSE client disconnected from trace stream', {
        clientId: req.ip,
      });
    });
  });

  logger.info('Tracing UI routes registered', {
    dashboardUrl: '/ui/tracing',
    streamUrl: '/traces/stream',
    dashboardPath: dashboardPath ?? 'not-built',
  });
}
