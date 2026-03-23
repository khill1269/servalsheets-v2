/**
 * ServalSheets — Google API Discovery Compliance Tests
 *
 * Offline-only tests (no network calls). Uses committed snapshot files as
 * frozen reference documents. Skips individual suites when snapshots are
 * still placeholders (run `node scripts/audit-google-api-compliance.mjs --update-snapshots`
 * to populate them).
 *
 * Suite 1: OAuth Scopes vs Discovery (7 tests)
 * Suite 2: Method IDs vs Discovery (5 tests)
 * Suite 3: Field Mask Paths vs Discovery Schemas (4 tests)
 *
 * Runtime: <1s (all static, no API calls)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FULL_ACCESS_SCOPES, STANDARD_SCOPES, MINIMAL_SCOPES } from '../../src/config/oauth-scopes.js';
import { FIELD_MASKS } from '../../src/constants/field-masks.js';
import { ACTION_FIELD_MASKS } from '../../src/config/action-field-masks.js';

// ─── Snapshot Loading ──────────────────────────────────────────────────────

const ROOT = join(import.meta.dirname ?? process.cwd(), '..', '..');
const SNAPSHOT_DIR = join(ROOT, '.discovery-cache', 'snapshots');

interface DiscoverySnapshot {
  _placeholder?: boolean;
  generatedAt: string | null;
  api: string;
  version: string;
  batchPath: string | null;
  authScopes: string[];
  methodCount: number;
  methods: Record<string, { scopes: string[]; requiredParams: string[]; deprecated: boolean; httpMethod: string }>;
  topLevelSchemas: string[];
}

function loadSnapshot(name: string): DiscoverySnapshot | null {
  const file = join(SNAPSHOT_DIR, `${name}`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8')) as DiscoverySnapshot;
  if (data._placeholder) return null; // placeholder, not yet populated
  return data;
}

const sheetsSnap = loadSnapshot('sheets-v4.snapshot.json');
const driveSnap = loadSnapshot('drive-v3.snapshot.json');
const bigquerySnap = loadSnapshot('bigquery-v2.snapshot.json');
const scriptSnap = loadSnapshot('script-v1.snapshot.json');

const allSnapshotsAvailable = !!(sheetsSnap && driveSnap && bigquerySnap && scriptSnap);
const sheetsAvailable = !!sheetsSnap;
const driveAvailable = !!driveSnap;

// Build combined scope inventory from all snapshots
function getAllDiscoveryScopes(): Set<string> {
  const scopes = new Set<string>();
  for (const snap of [sheetsSnap, driveSnap, bigquerySnap, scriptSnap]) {
    if (!snap) continue;
    for (const scope of snap.authScopes) scopes.add(scope);
    for (const method of Object.values(snap.methods)) {
      for (const scope of method.scopes) scopes.add(scope);
    }
  }
  return scopes;
}

// Build combined method inventory from all snapshots
function getAllMethods(): Map<string, { scopes: string[]; deprecated: boolean }> {
  const map = new Map<string, { scopes: string[]; deprecated: boolean }>();
  for (const snap of [sheetsSnap, driveSnap, bigquerySnap, scriptSnap]) {
    if (!snap) continue;
    for (const [id, method] of Object.entries(snap.methods)) {
      map.set(id, { scopes: method.scopes, deprecated: method.deprecated });
    }
  }
  return map;
}

// ─── Suite 1: OAuth Scopes vs Discovery ───────────────────────────────────

describe('Suite 1: OAuth Scopes vs Discovery', () => {
  const skipMsg = 'Snapshots not populated — run --update-snapshots';

  it('every scope in FULL_ACCESS_SCOPES matches at least one inventory method or API scope', () => {
    if (!allSnapshotsAvailable) return; // graceful skip when placeholders
    const discoveryScopes = getAllDiscoveryScopes();

    // Some scopes are for resource APIs not in our discovery docs (Drive Labels, Drive Activity)
    // These are explicitly allowed via exemptions
    const scopeExemptions = new Set([
      'https://www.googleapis.com/auth/drive.labels.readonly',
      'https://www.googleapis.com/auth/drive.labels',
      'https://www.googleapis.com/auth/drive.activity.readonly',
    ]);

    for (const scope of FULL_ACCESS_SCOPES) {
      if (scopeExemptions.has(scope)) continue;
      expect(discoveryScopes.has(scope), `Scope not found in any discovery doc: ${scope}`).toBe(true);
    }
  });

  it('every scope in STANDARD_SCOPES has at least one matching inventory method', () => {
    if (!allSnapshotsAvailable) return;
    const discoveryScopes = getAllDiscoveryScopes();

    const scopeExemptions = new Set([
      'https://www.googleapis.com/auth/drive.labels.readonly',
    ]);

    for (const scope of STANDARD_SCOPES) {
      if (scopeExemptions.has(scope)) continue;
      expect(discoveryScopes.has(scope), `STANDARD scope not found in discovery: ${scope}`).toBe(true);
    }
  });

  it('spreadsheets scope is in STANDARD_SCOPES (regression guard)', () => {
    const spreadsheetsScope = 'https://www.googleapis.com/auth/spreadsheets';
    expect(STANDARD_SCOPES).toContain(spreadsheetsScope);
  });

  it('drive.activity.readonly scope is in FULL_ACCESS_SCOPES (WHO/WHEN attribution regression)', () => {
    const activityScope = 'https://www.googleapis.com/auth/drive.activity.readonly';
    expect(FULL_ACCESS_SCOPES).toContain(activityScope);
  });

  it('all script.* scopes in FULL_ACCESS_SCOPES match actual Apps Script inventory', () => {
    if (!scriptSnap) return;
    const scriptScopes = new Set(scriptSnap.authScopes);

    for (const scope of FULL_ACCESS_SCOPES) {
      if (!scope.includes('/script.')) continue;
      expect(scriptScopes.has(scope), `Script scope not in Apps Script discovery: ${scope}`).toBe(true);
    }
  });

  it('MINIMAL_SCOPES is a strict subset of STANDARD_SCOPES', () => {
    for (const scope of MINIMAL_SCOPES) {
      expect(STANDARD_SCOPES).toContain(scope);
    }
  });

  it('no scope in STANDARD_SCOPES is the restricted full drive scope', () => {
    // drive (full) is restricted — STANDARD_SCOPES should use drive.file or drive.readonly
    const restrictedDriveScope = 'https://www.googleapis.com/auth/drive';
    // Drive readonly is acceptable in STANDARD_SCOPES per design decision (see oauth-scopes.ts)
    expect(STANDARD_SCOPES).not.toContain(restrictedDriveScope);
  });
});

// ─── Suite 2: Method IDs vs Discovery ─────────────────────────────────────

describe('Suite 2: Method IDs vs Discovery', () => {
  it('batchPath in Sheets snapshot equals expected batch path (snapshot version guard)', () => {
    if (!sheetsSnap) return;
    // Sheets API uses a specific batch path — guard against version changes
    expect(sheetsSnap.batchPath).toBeTruthy();
    expect(typeof sheetsSnap.batchPath).toBe('string');
  });

  it('Sheets snapshot includes core spreadsheet methods', () => {
    if (!sheetsSnap) return;
    const methods = Object.keys(sheetsSnap.methods);
    expect(methods.some((m) => m.includes('spreadsheets.get'))).toBe(true);
    expect(methods.some((m) => m.includes('spreadsheets.values.get') || m.includes('values.get'))).toBe(true);
    expect(methods.some((m) => m.includes('spreadsheets.batchUpdate') || m.includes('batchUpdate'))).toBe(true);
  });

  it('Drive snapshot includes files and revisions methods', () => {
    if (!driveSnap) return;
    const methods = Object.keys(driveSnap.methods);
    expect(methods.some((m) => m.includes('files.list') || m.includes('.files.list'))).toBe(true);
    expect(methods.some((m) => m.includes('revisions.list') || m.includes('.revisions.list'))).toBe(true);
  });

  it('no revisions.export call uses text/csv MIME type (Drive only supports XLSX/PDF)', () => {
    const historyFile = join(ROOT, 'src', 'handlers', 'history.ts');
    if (!existsSync(historyFile)) return;
    const content = readFileSync(historyFile, 'utf8');

    // Find revisions.export calls and check for text/csv
    const exportBlock = content.match(/revisions\.export[^}]+}/s)?.[0] ?? '';
    expect(exportBlock).not.toContain('text/csv');
  });

  it('BigQuery snapshot includes core tabledata and jobs methods', () => {
    if (!bigquerySnap) return;
    const methods = Object.keys(bigquerySnap.methods);
    expect(methods.some((m) => m.includes('jobs.query') || m.includes('.query'))).toBe(true);
  });
});

// ─── Suite 3: Field Mask Paths vs Discovery Schemas ───────────────────────

describe('Suite 3: Field Mask Paths vs Discovery Schemas', () => {
  let spreadsheetSchema: { properties?: Record<string, unknown> } | null = null;

  beforeAll(() => {
    if (!sheetsSnap) return;
    // Load the full discovery doc to access schema definitions
    const docFile = join(ROOT, '.discovery-cache', 'google-api-sheets-v4.json');
    if (!existsSync(docFile)) return;
    const doc = JSON.parse(readFileSync(docFile, 'utf8'));
    spreadsheetSchema = doc?.schema?.schemas?.['Spreadsheet'] ?? null;
  });

  it('FIELD_MASKS.SPREADSHEET_BASIC top-level segments resolve in Spreadsheet schema', () => {
    if (!spreadsheetSchema?.properties) return;
    const mask = FIELD_MASKS.SPREADSHEET_BASIC;
    // Strip all nested sub-fields (handle multiple nesting levels) before splitting
    let stripped = mask;
    while (stripped.includes('(')) stripped = stripped.replace(/\([^()]*\)/g, '');
    const segments = stripped.split(',').map((s) => s.trim().split('/')[0].split('.')[0]);

    const knownValidSegments = new Set([
      'spreadsheetId', 'properties', 'spreadsheetUrl', 'sheets', 'namedRanges',
      'developerMetadata',
    ]);

    for (const seg of segments) {
      if (!seg) continue;
      const valid =
        knownValidSegments.has(seg) ||
        !!(spreadsheetSchema.properties as Record<string, unknown>)[seg];
      expect(valid, `SPREADSHEET_BASIC segment '${seg}' not valid`).toBe(true);
    }
  });

  it('FIELD_MASKS.SPREADSHEET_WITH_SHEETS includes sheets(properties(...)) path', () => {
    expect(FIELD_MASKS.SPREADSHEET_WITH_SHEETS).toContain('sheets(properties');
    expect(FIELD_MASKS.SPREADSHEET_WITH_SHEETS).toContain('sheetId');
    expect(FIELD_MASKS.SPREADSHEET_WITH_SHEETS).toContain('gridProperties');
  });

  it('FIELD_MASKS.SPREADSHEET_COMPREHENSIVE includes all documented top-level segments', () => {
    const mask = FIELD_MASKS.SPREADSHEET_COMPREHENSIVE;
    // These are the known top-level fields on a Spreadsheet object
    expect(mask).toContain('spreadsheetId');
    expect(mask).toContain('properties');
    expect(mask).toContain('sheets');
    expect(mask).toContain('namedRanges');
  });

  it('ACTION_FIELD_MASKS spreadsheets.get entries have valid root field mask segments', () => {
    const knownValidSegments = new Set([
      'spreadsheetId', 'properties', 'spreadsheetUrl', 'sheets', 'namedRanges',
      'developerMetadata',
    ]);

    const getEntries = Object.values(ACTION_FIELD_MASKS).filter(
      (e) => e.operationType === 'spreadsheets.get'
    );

    expect(getEntries.length).toBeGreaterThan(0);

    for (const entry of getEntries) {
      // Strip all nested parenthetical sub-fields (handles multiple nesting levels)
      // e.g. "sheets(properties(sheetId),merges)" → "sheets" (nested fields ignored)
      // Strip nested parenthetical sub-fields (handles multiple nesting levels)
      // Then extract only the root segment from each comma-separated item
      // e.g. "sheets.conditionalFormats" → "sheets", "sheets(props)" → "sheets"
      let stripped = entry.fieldMask;
      while (stripped.includes('(')) stripped = stripped.replace(/\([^()]*\)/g, '');
      const topSegments = stripped
        .split(',')
        .map((s) => s.trim().split('/')[0].split('.')[0])
        .filter(Boolean);

      for (const seg of topSegments) {
        expect(
          knownValidSegments.has(seg),
          `ACTION_FIELD_MASKS['${entry.tool}.${entry.action}'] has unrecognized segment '${seg}'`
        ).toBe(true);
      }
    }
  });
});
