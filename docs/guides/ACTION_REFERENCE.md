---
title: ServalSheets - Action Reference
category: guide
last_updated: 2026-01-31
description: 'Version: v1.7.0'
version: 1.7.0
audience: user
difficulty: intermediate
---

# ServalSheets - Action Reference

**Version**: v1.7.0
**Date**: 2026-03-08
**Total**: 25 tools, 403 actions

## Current Tool List

For the complete and up-to-date list of tools and actions, please refer to the source code:

**Source of Truth:**

- Tool schemas: `src/schemas/*.ts`
- Tool registry: `src/schemas/index.ts`
- Generated metadata: `server.json` (auto-generated)

**View Current Tools:**

```bash
# Display all registered tools with their actions
npm run show:tools

# Or check the metadata directly
npm run check:drift
```

## Tool Categories

ServalSheets provides 19 production tools across these categories:

### Core Operations

- **sheets_auth** - Authentication & OAuth
- **sheets_core** - Spreadsheet CRUD operations
- **sheets_data** - Read/write cell values
- **sheets_dimensions** - Row/column operations
- **sheets_format** - Cell formatting
- **sheets_advanced** - Named ranges, protection, metadata

### Analysis & Quality

- **sheets_analyze** - AI-powered analysis (quality, patterns, formulas)
- **sheets_quality** - Validation and quality checks

### Collaboration

- **sheets_collaborate** - Sharing and permissions
- **sheets_session** - Session context management

### Data Operations

- **sheets_composite** - Multi-step operations
- **sheets_visualize** - Charts and visualization

### Safety & History

- **sheets_transaction** - Transaction management
- **sheets_history** - Operation history
- **sheets_confirm** - User confirmation (with Elicitation)
- **sheets_fix** - Automated issue resolution

## Detailed Action Listings

For detailed action schemas and parameter definitions:

1. **View Schema Files:** Each tool has its own schema in `src/schemas/`
   - Example: `src/schemas/data.ts` for sheets_data actions

2. **Check Tool Registration:** `src/mcp/registration/tool-definitions.ts`
   - Complete tool metadata and descriptions

3. **See Generated Documentation:** `server.json`
   - Auto-generated from schemas
   - Updated on every build

## Action Count by Tool

Run this command to see the current breakdown:

```bash
npm run gen:metadata
```

This will show:

- Total tools: 21
- Total actions: 291
- Per-tool action counts

## Important Notes

⚠️ **This file is intentionally minimal** - tool lists and action details change frequently. Rather than maintaining duplicate documentation that becomes stale, we reference the source code as the single source of truth.

For the most accurate and up-to-date information:

- Check `src/schemas/index.ts` for TOOL_COUNT and ACTION_COUNT constants
- Run `npm run check:drift` to verify metadata is synchronized
- View `server.json` for complete MCP tool definitions

---

**Last Updated:** 2026-01-20 (v1.5.0)
