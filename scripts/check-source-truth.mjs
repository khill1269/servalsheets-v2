#!/usr/bin/env node

import { ACTION_COUNTS, TOOL_COUNT, ACTION_COUNT } from '../dist/schemas/action-counts.js';
import { TOOL_DEFINITIONS } from '../dist/mcp/registration/tool-definitions.js';

const expectedToolCount = Object.keys(ACTION_COUNTS).length;
const expectedActionCount = Object.values(ACTION_COUNTS).reduce((sum, count) => sum + count, 0);

if (TOOL_COUNT !== expectedToolCount) {
  console.error(`❌ TOOL_COUNT mismatch: constant=${TOOL_COUNT}, derived=${expectedToolCount}`);
  process.exit(1);
}

if (ACTION_COUNT !== expectedActionCount) {
  console.error(`❌ ACTION_COUNT mismatch: constant=${ACTION_COUNT}, derived=${expectedActionCount}`);
  process.exit(1);
}

if (TOOL_DEFINITIONS.length !== TOOL_COUNT) {
  console.error(
    `❌ Tool definition mismatch: TOOL_DEFINITIONS=${TOOL_DEFINITIONS.length}, TOOL_COUNT=${TOOL_COUNT}`
  );
  process.exit(1);
}

const declaredTools = new Set(Object.keys(ACTION_COUNTS));
const runtimeTools = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
const missing = [...declaredTools].filter((name) => !runtimeTools.has(name));
const extra = [...runtimeTools].filter((name) => !declaredTools.has(name));

if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) {
    console.error(`❌ Missing tool definitions for: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    console.error(`❌ Unexpected tool definitions found: ${extra.join(', ')}`);
  }
  process.exit(1);
}

console.log(`✓ Source of truth confirmed: ${TOOL_COUNT} tools, ${ACTION_COUNT} actions`);
