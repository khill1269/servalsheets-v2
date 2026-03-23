---
title: Request Tracing Dashboard
category: runbook
last_updated: 2026-02-17
description: Interactive UI for visualizing request traces with flame graphs
version: 1.0.0
tags: [tracing, observability, debugging, flame-graph]
---

# Request Tracing Dashboard

Interactive web UI for visualizing ServalSheets request traces with flame graphs and real-time streaming.

## Quick Start

```bash
# 1. Enable trace aggregation
export TRACE_AGGREGATION_ENABLED=true

# 2. Build dashboard
npm run build:ui

# 3. Start server
npm run start:http

# 4. Access dashboard
open http://localhost:3000/ui/tracing
```

## Features

- Flame Graph - D3.js interactive visualization
- Span Analysis - Detailed timing and attributes
- Real-Time Streaming - SSE live updates
- Advanced Filtering - Tool/action/duration/error
- Performance Metrics - P50/P95/P99 latencies
- JSON Export - Offline analysis

## API Endpoints

- `GET /ui/tracing` - Dashboard HTML
- `GET /traces/stream` - SSE live traces
- `GET /traces` - Search traces
- `GET /traces/recent` - Recent traces
- `GET /traces/slow` - Slowest traces
- `GET /traces/errors` - Error traces
- `GET /traces/stats` - Statistics
- `GET /traces/:requestId` - Specific trace

## Configuration

```bash
# Environment variables
TRACE_AGGREGATION_ENABLED=true      # Enable tracing
TRACE_AGGREGATION_MAX_SIZE=1000     # Max traces
TRACE_AGGREGATION_TTL=300000        # 5 min TTL
```

## Troubleshooting

**Dashboard not loading:**

- Run `npm run build:ui`
- Check backend is running on port 3000

**No traces visible:**

- Enable: `TRACE_AGGREGATION_ENABLED=true`
- Make API requests to generate traces

**SSE connection fails:**

- Check CORS settings
- Verify `/traces/stream` endpoint

---

**Access:** http://localhost:3000/ui/tracing
**Tech:** React + TypeScript + D3 + Vite
**Version:** 1.0.0 | **Status:** Production Ready
