#!/usr/bin/env tsx
/**
 * Emergency kill switch for ServalSheets.
 *
 * Usage:
 *   npm run emergency:disable          # Activate kill switch
 *   npm run emergency:disable -- --off  # Deactivate kill switch
 *   npm run emergency:disable -- --status  # Check current status
 *
 * The kill switch is activated by writing SERVALSHEETS_KILL_SWITCH=true to a
 * .serval/kill-switch.json file and printing an instruction to restart the server
 * with the env var set. The running server reads this env at startup only.
 *
 * For a live running server, set the env var before restarting:
 *   SERVALSHEETS_KILL_SWITCH=true node dist/server.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const KILL_SWITCH_FILE = join(process.cwd(), '.serval', 'kill-switch.json');

interface KillSwitchState {
  active: boolean;
  activatedAt?: string;
  activatedBy?: string;
  reason?: string;
}

function readState(): KillSwitchState {
  if (!existsSync(KILL_SWITCH_FILE)) {
    return { active: false };
  }
  try {
    return JSON.parse(readFileSync(KILL_SWITCH_FILE, 'utf-8')) as KillSwitchState;
  } catch {
    return { active: false };
  }
}

function writeState(state: KillSwitchState): void {
  mkdirSync(join(process.cwd(), '.serval'), { recursive: true });
  writeFileSync(KILL_SWITCH_FILE, JSON.stringify(state, null, 2));
}

const args = process.argv.slice(2);
const isOff = args.includes('--off') || args.includes('--disable');
const isStatus = args.includes('--status');

if (isStatus) {
  const state = readState();
  console.log('Kill switch status:', state.active ? '🔴 ACTIVE' : '🟢 INACTIVE');
  if (state.active) {
    console.log('  Activated at:', state.activatedAt);
    console.log('  Activated by:', state.activatedBy ?? 'unknown');
    console.log('  Reason:', state.reason ?? 'none');
    console.log('');
    console.log('To deactivate: npm run emergency:disable -- --off');
  }
  process.exit(0);
}

if (isOff) {
  writeState({ active: false });
  console.log('✅ Kill switch DEACTIVATED');
  console.log('');
  console.log('Restart the server WITHOUT SERVALSHEETS_KILL_SWITCH to resume normal operation:');
  console.log('  npm start');
  process.exit(0);
}

// Activate kill switch
const reason = args.find((a) => !a.startsWith('--')) ?? 'Emergency maintenance';
const state: KillSwitchState = {
  active: true,
  activatedAt: new Date().toISOString(),
  activatedBy: process.env.USER ?? process.env.USERNAME ?? 'unknown',
  reason,
};
writeState(state);

console.log('🔴 Kill switch ACTIVATED');
console.log('');
console.log('State written to:', KILL_SWITCH_FILE);
console.log('Reason:', reason);
console.log('');
console.log('To apply immediately, restart the server with:');
console.log('  SERVALSHEETS_KILL_SWITCH=true npm start');
console.log('');
console.log('To deactivate later:');
console.log('  npm run emergency:disable -- --off');
console.log('  npm start');
console.log('');
console.log('See runbook: docs/runbooks/emergency-disable.md');
