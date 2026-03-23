/**
 * ServalSheets - Handler Optimization Benchmark
 *
 * Benchmarks the Phase 2 handler optimizations:
 * - Action dispatch (Map vs switch)
 * - Cache key generation
 * - Cell counting
 * - Response building
 */

import {
  createActionDispatcher,
  fastCacheKey,
  spreadsheetCacheKey,
  countCells,
  truncateValues,
  hasRequiredParams,
  fastSuccess,
  fastError,
  fastParseA1Range,
  estimateRangeCells,
  columnLetterToIndex,
} from '../src/handlers/optimization.js';

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

function benchmark(
  name: string,
  iterations: number,
  fn: () => void
): { name: string; avgNs: number; totalMs: number } {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = process.hrtime.bigint();
  const totalNs = Number(end - start);
  const avgNs = totalNs / iterations;
  const totalMs = totalNs / 1_000_000;

  return { name, avgNs, totalMs };
}

// ============================================================================
// TEST DATA
// ============================================================================

const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const RANGE = 'Sheet1!A1:Z1000';

const SAMPLE_VALUES: unknown[][] = Array.from({ length: 100 }, (_, i) =>
  Array.from({ length: 10 }, (_, j) => `Cell ${i},${j}`)
);

const LARGE_VALUES: unknown[][] = Array.from({ length: 1000 }, (_, i) =>
  Array.from({ length: 20 }, (_, j) => `Cell ${i},${j}`)
);

// ============================================================================
// BASELINE IMPLEMENTATIONS (for comparison)
// ============================================================================

// Baseline: switch statement dispatch
function baselineSwitchDispatch(action: string): string {
  switch (action) {
    case 'read':
      return 'read';
    case 'write':
      return 'write';
    case 'append':
      return 'append';
    case 'clear':
      return 'clear';
    case 'batch_read':
      return 'batch_read';
    case 'batch_write':
      return 'batch_write';
    case 'find':
      return 'find';
    case 'replace':
      return 'replace';
    default:
      return 'unknown';
  }
}

// Baseline: JSON stringify cache key
function baselineCacheKey(operation: string, spreadsheetId: string, range: string): string {
  return JSON.stringify({ operation, spreadsheetId, range });
}

// Baseline: reduce for cell count
function baselineCellCount(values: unknown[][]): number {
  return values.reduce((sum, row) => sum + row.length, 0);
}

// Baseline: Object creation for response
function baselineSuccess<T extends Record<string, unknown>>(
  action: string,
  data: T
): T & { success: true; action: string } {
  return Object.assign({}, { success: true as const, action }, data);
}

// ============================================================================
// BENCHMARKS
// ============================================================================

const ITERATIONS = 100_000;

console.log('ServalSheets Handler Optimization Benchmark');
console.log('='.repeat(60));
console.log(`Iterations: ${ITERATIONS.toLocaleString()}\n`);

// 1. Action Dispatch
console.log('1. Action Dispatch (Map vs Switch)');
console.log('-'.repeat(40));

const dispatchMap = new Map([
  ['read', () => 'read'],
  ['write', () => 'write'],
  ['append', () => 'append'],
  ['clear', () => 'clear'],
  ['batch_read', () => 'batch_read'],
  ['batch_write', () => 'batch_write'],
  ['find', () => 'find'],
  ['replace', () => 'replace'],
]);

const switchResult = benchmark('Switch Statement', ITERATIONS, () => {
  baselineSwitchDispatch('read');
  baselineSwitchDispatch('write');
  baselineSwitchDispatch('append');
});

const mapResult = benchmark('Map Lookup', ITERATIONS, () => {
  dispatchMap.get('read')?.();
  dispatchMap.get('write')?.();
  dispatchMap.get('append')?.();
});

console.log(`  Switch: ${switchResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Map:    ${mapResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Speedup: ${(switchResult.avgNs / mapResult.avgNs).toFixed(1)}x\n`);

// 2. Cache Key Generation
console.log('2. Cache Key Generation');
console.log('-'.repeat(40));

const jsonKeyResult = benchmark('JSON.stringify', ITERATIONS, () => {
  baselineCacheKey('values:read', SPREADSHEET_ID, RANGE);
});

const fastKeyResult = benchmark('String concatenation', ITERATIONS, () => {
  spreadsheetCacheKey('values:read', SPREADSHEET_ID, RANGE);
});

console.log(`  JSON.stringify: ${jsonKeyResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Fast concat:    ${fastKeyResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Speedup: ${(jsonKeyResult.avgNs / fastKeyResult.avgNs).toFixed(1)}x\n`);

// 3. Cell Counting
console.log('3. Cell Counting (100 rows x 10 cols)');
console.log('-'.repeat(40));

const reduceCellResult = benchmark('Array.reduce', ITERATIONS, () => {
  baselineCellCount(SAMPLE_VALUES);
});

const forLoopCellResult = benchmark('For loop', ITERATIONS, () => {
  countCells(SAMPLE_VALUES);
});

console.log(`  Array.reduce: ${reduceCellResult.avgNs.toFixed(1)} ns/op`);
console.log(`  For loop:     ${forLoopCellResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Speedup: ${(reduceCellResult.avgNs / forLoopCellResult.avgNs).toFixed(1)}x\n`);

// 4. Large Cell Counting
console.log('4. Large Cell Counting (1000 rows x 20 cols)');
console.log('-'.repeat(40));

const largeReduceResult = benchmark('Array.reduce', ITERATIONS / 10, () => {
  baselineCellCount(LARGE_VALUES);
});

const largeForLoopResult = benchmark('For loop', ITERATIONS / 10, () => {
  countCells(LARGE_VALUES);
});

console.log(`  Array.reduce: ${largeReduceResult.avgNs.toFixed(1)} ns/op`);
console.log(`  For loop:     ${largeForLoopResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Speedup: ${(largeReduceResult.avgNs / largeForLoopResult.avgNs).toFixed(1)}x\n`);

// 5. Response Building
console.log('5. Response Building');
console.log('-'.repeat(40));

const objectAssignResult = benchmark('Object.assign', ITERATIONS, () => {
  baselineSuccess('read', { values: SAMPLE_VALUES, range: RANGE });
});

const spreadResult = benchmark('Spread operator', ITERATIONS, () => {
  fastSuccess('read', { values: SAMPLE_VALUES, range: RANGE });
});

console.log(`  Object.assign: ${objectAssignResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Spread:        ${spreadResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Speedup: ${(objectAssignResult.avgNs / spreadResult.avgNs).toFixed(1)}x\n`);

// 6. Range Parsing
console.log('6. A1 Range Parsing');
console.log('-'.repeat(40));

const rangeParseResult = benchmark('fastParseA1Range', ITERATIONS, () => {
  fastParseA1Range('Sheet1!A1:Z1000');
  fastParseA1Range('Data!B5:D100');
  fastParseA1Range('A1');
});

console.log(`  Parse: ${rangeParseResult.avgNs.toFixed(1)} ns/op\n`);

// 7. Column Letter to Index
console.log('7. Column Letter to Index (with caching)');
console.log('-'.repeat(40));

// Prime the cache
columnLetterToIndex('A');
columnLetterToIndex('Z');
columnLetterToIndex('AA');
columnLetterToIndex('ZZ');

const colIndexResult = benchmark('columnLetterToIndex', ITERATIONS, () => {
  columnLetterToIndex('A');
  columnLetterToIndex('Z');
  columnLetterToIndex('AA');
  columnLetterToIndex('ZZ');
});

console.log(`  Cached lookup: ${colIndexResult.avgNs.toFixed(1)} ns/op\n`);

// 8. Parameter Check
console.log('8. Required Parameter Check');
console.log('-'.repeat(40));

const testInput = { spreadsheetId: SPREADSHEET_ID, range: RANGE, action: 'read' };

const manualCheckResult = benchmark('Manual check', ITERATIONS, () => {
  testInput.spreadsheetId !== undefined &&
    testInput.range !== undefined &&
    testInput.action !== undefined;
});

const hasParamsResult = benchmark('hasRequiredParams', ITERATIONS, () => {
  hasRequiredParams(testInput, 'spreadsheetId', 'range', 'action');
});

console.log(`  Manual check:      ${manualCheckResult.avgNs.toFixed(1)} ns/op`);
console.log(`  hasRequiredParams: ${hasParamsResult.avgNs.toFixed(1)} ns/op\n`);

// 9. Values Truncation
console.log('9. Values Truncation (1000 rows -> 100 rows)');
console.log('-'.repeat(40));

const truncateResult = benchmark('truncateValues', ITERATIONS / 10, () => {
  truncateValues(LARGE_VALUES, 100, 5000);
});

console.log(`  Truncate: ${truncateResult.avgNs.toFixed(1)} ns/op\n`);

// Summary
console.log('='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const improvements = [
  { name: 'Cache key generation', speedup: jsonKeyResult.avgNs / fastKeyResult.avgNs },
  { name: 'Cell counting (small)', speedup: reduceCellResult.avgNs / forLoopCellResult.avgNs },
  { name: 'Cell counting (large)', speedup: largeReduceResult.avgNs / largeForLoopResult.avgNs },
];

for (const { name, speedup } of improvements) {
  console.log(`  ${name}: ${speedup.toFixed(1)}x faster`);
}

const avgSpeedup = improvements.reduce((sum, i) => sum + i.speedup, 0) / improvements.length;
console.log(`\n  Average improvement: ${avgSpeedup.toFixed(1)}x`);
console.log('\nNote: Map dispatch is similar to switch for simple cases.');
console.log('Real gains come from reduced allocations in hot paths.');
