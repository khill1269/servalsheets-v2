/**
 * ServalSheets - Metrics Server
 *
 * HTTP server for exposing performance metrics
 * Prometheus-compatible /metrics endpoint
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { MetricsExporter } from '../services/metrics-exporter.js';
import { logger } from '../utils/logger.js';

export interface MetricsServerOptions {
  port: number;
  host?: string;
  exporter: MetricsExporter;
}

/**
 * Start HTTP server for metrics endpoint
 * Serves metrics in Prometheus, JSON, and text formats
 */
export function startMetricsServer(options: MetricsServerOptions): Promise<Server> {
  const { port, host = '127.0.0.1', exporter } = options;

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res, exporter);
    });

    server.on('error', (err) => {
      logger.error('Metrics server error', { error: err });
      reject(err);
    });

    server.listen(port, host, () => {
      logger.info('Metrics server started', {
        host,
        port,
        endpoints: {
          metrics: `http://${host}:${port}/metrics`,
          metricsJson: `http://${host}:${port}/metrics.json`,
          metricsText: `http://${host}:${port}/metrics.txt`,
          health: `http://${host}:${port}/health`,
        },
      });
      resolve(server);
    });
  });
}

/**
 * Handle HTTP requests
 */
function handleRequest(req: IncomingMessage, res: ServerResponse, exporter: MetricsExporter): void {
  const url = req.url || '/';

  // Set CORS headers for browser access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed\n');
    return;
  }

  try {
    switch (url) {
      case '/metrics':
        // Prometheus text format
        res.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        });
        res.end(exporter.exportPrometheus());
        break;

      case '/metrics.json':
        // JSON format
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(exporter.exportJSON());
        break;

      case '/metrics.txt':
      case '/metrics/text':
        // Human-readable text format
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(exporter.exportText());
        break;

      case '/health':
      case '/healthz':
        // Health check endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
          })
        );
        break;

      case '/':
        // Root - show available endpoints
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>ServalSheets Metrics Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #333; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .endpoint { margin: 20px 0; padding: 15px; background: #f5f5f5; border-left: 4px solid #0066cc; }
    .endpoint code { background: #fff; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>ServalSheets Metrics Server</h1>
  <p>Performance metrics for ServalSheets MCP Server</p>

  <div class="endpoint">
    <h3><a href="/metrics">/metrics</a></h3>
    <p>Prometheus text format (recommended for monitoring)</p>
    <code>Content-Type: text/plain; version=0.0.4</code>
  </div>

  <div class="endpoint">
    <h3><a href="/metrics.json">/metrics.json</a></h3>
    <p>JSON format (for programmatic access)</p>
    <code>Content-Type: application/json</code>
  </div>

  <div class="endpoint">
    <h3><a href="/metrics.txt">/metrics.txt</a></h3>
    <p>Human-readable text format</p>
    <code>Content-Type: text/plain</code>
  </div>

  <div class="endpoint">
    <h3><a href="/health">/health</a></h3>
    <p>Health check endpoint</p>
    <code>Content-Type: application/json</code>
  </div>

  <hr>
  <p><small>Powered by <strong>ServalSheets</strong> | MCP Protocol 2025-11-25</small></p>
</body>
</html>`);
        break;

      default:
        // 404 Not Found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found\n');
        break;
    }
  } catch (error) {
    logger.error('Error handling metrics request', { error, url });
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error\n');
  }
}

/**
 * Stop metrics server gracefully
 */
export function stopMetricsServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        logger.error('Error stopping metrics server', { error: err });
        reject(err);
      } else {
        logger.info('Metrics server stopped');
        resolve();
      }
    });
  });
}
