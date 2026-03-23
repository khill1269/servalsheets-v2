# ServalSheets Tracing Dashboard

Interactive React dashboard for visualizing request traces with flame graphs.

## Quick Start

```bash
npm install        # Install dependencies
npm run dev        # Development (Vite HMR)
npm run build      # Production build
npm run typecheck  # Type checking
```

## Tech Stack

- React 18 + TypeScript
- Vite (build tool with HMR)
- D3.js + d3-flame-graph
- Server-Sent Events (SSE)

## Project Structure

```
src/
├── main.tsx           # React entry
├── App.tsx            # Main layout
├── types.ts           # TypeScript types
├── api.ts             # API client (REST + SSE)
├── utils.ts           # Helper functions
└── components/
    ├── FlameGraph.tsx
    ├── SpanTable.tsx
    ├── TraceList.tsx
    ├── TraceDetail.tsx
    ├── FilterBar.tsx
    └── StatsPanel.tsx
```

## Features

- Flame Graph - Interactive hierarchical view
- Span Analysis - Detailed span table
- Real-Time Streaming - Live trace updates
- Advanced Filtering - Multi-criteria search
- Performance Metrics - P50/P95/P99
- JSON Export - Download traces

## Development

**Dev server:** http://localhost:5173
**Production:** http://localhost:3000/ui/tracing

Backend API proxied to `http://localhost:3000/traces`

## Build

```bash
npm run build
# Output: dist/index.html, dist/assets/*
```

## Integration

Built dashboard served by ServalSheets HTTP server:

- See `src/http-server-tracing-ui.ts`
- Route: `GET /ui/tracing`

---

**Full Docs:** `docs/operations/TRACING_DASHBOARD.md`
