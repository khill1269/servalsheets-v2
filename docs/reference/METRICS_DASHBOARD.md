---
title: Documentation Metrics Dashboard
description: Real-time metrics and health indicators for ServalSheets documentation
category: reference
last_updated: 2026-01-31
---

# Documentation Metrics Dashboard

> **Last Updated:** 2026-01-31 | **Auto-generated** - Run `npm run docs:metrics` to refresh

## 📊 Overview

| Metric          | Count   |
| --------------- | ------- |
| Total Documents | 142     |
| Total Words     | 127,957 |
| Total Lines     | 69,870  |
| Avg Words/Doc   | 901     |
| Categories      | 10      |
| Unique Tags     | 36      |

## 📈 Quality Metrics

| Metric           | Count | Percentage |
| ---------------- | ----- | ---------- |
| With Frontmatter | 142   | 100.0%     |
| With Description | 141   | 99.3%      |
| With Tags        | 105   | 73.9%      |

## 🕒 Freshness

| Status                | Count | Percentage |
| --------------------- | ----- | ---------- |
| ✅ Fresh (< 3 mo)     | 142   | 100.0%     |
| ⏰ Aging (3-6 mo)     | 0     | 0.0%       |
| ⚠️ Stale (6-12 mo)    | 0     | 0.0%       |
| 🚨 Critical (> 12 mo) | 0     | 0.0%       |

**Documentation Health Score:** 100.0% ✅

## 📂 By Category

| Category     | Files | Total Words | Avg Words/Doc |
| ------------ | ----- | ----------- | ------------- |
| general      | 45    | 32,231      | 716           |
| guide        | 33    | 33,906      | 1027          |
| development  | 27    | 25,067      | 928           |
| business     | 11    | 14,622      | 1329          |
| reference    | 9     | 6,745       | 749           |
| runbook      | 8     | 5,459       | 682           |
| example      | 6     | 4,715       | 786           |
| metrics      | 1     | 507         | 507           |
| index        | 1     | 3,776       | 3776          |
| architecture | 1     | 929         | 929           |

## 🏷️ Top Tags

| Tag             | Count |
| --------------- | ----- |
| sheets          | 80    |
| docker          | 23    |
| prometheus      | 20    |
| kubernetes      | 14    |
| testing         | 13    |
| deployment      | 9     |
| grafana         | 7     |
| setup           | 7     |
| configuration   | 7     |
| mcp             | 5     |
| api             | 5     |
| oauth           | 4     |
| authentication  | 4     |
| troubleshooting | 2     |
| analysis        | 2     |

## 👥 Top Contributors

| Contributor   | Doc Commits |
| ------------- | ----------- |
| Thomas Cahill | 29          |

## 📅 Recent Activity

| Date       | File                                     | Action                                             |
| ---------- | ---------------------------------------- | -------------------------------------------------- |
| 2026-01-30 | MCP_2025-11-25_COMPLIANCE_CHECKLIST.md   | docs: Complete Phase 0 improvements (OTEL, vers... |
| 2026-01-30 | BUG_FIXES_2026-01-30.md                  | fix(retry): Add HTTP/2 GOAWAY error handling fo... |
| 2026-01-30 | API_MCP_MAPPING_MATRIX.md                | docs: Update all version references to v1.6.0      |
| 2026-01-30 | architecture-diagrams.md                 | docs: Update all version references to v1.6.0      |
| 2026-01-30 | development/ADVANCED_TESTING_STRATEGY.md | docs: Update all version references to v1.6.0      |
| 2026-01-30 | development/DOCUMENTATION.md             | docs: Update all version references to v1.6.0      |
| 2026-01-30 | guides/CLAUDE_DESKTOP_SETUP.md           | docs: Update all version references to v1.6.0      |
| 2026-01-30 | guides/ERROR_HANDLING.md                 | docs: Update all version references to v1.6.0      |
| 2026-01-30 | guides/INSTALLATION_GUIDE.md             | docs: Update all version references to v1.6.0      |
| 2026-01-30 | guides/USAGE_GUIDE.md                    | docs: Update all version references to v1.6.0      |

---

## How to Update

```bash
npm run docs:metrics  # Regenerate this dashboard
npm run docs:freshness # Check doc freshness
npm run docs:audit    # Full documentation audit
```
