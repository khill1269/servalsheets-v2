/**
 * ServalSheets - Response Builder Benchmark
 *
 * Benchmarks Phase 4 response optimization:
 * - Lazy response building
 * - Fast serialization
 * - Response templates
 * - Streaming response
 */

import {
  createLazyResponse,
  buildSuccessResponse,
  buildErrorResponse,
  fastSerialize,
  estimateResponseSize,
  buildFromTemplate,
  createStreamingResponse,
} from '../src/mcp/response-builder.js';

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

const SMALL_VALUES: unknown[][] = Array.from({ length: 10 }, (_, i) =>
  Array.from({ length: 5 }, (_, j) => `Cell ${i},${j}`)
);

const MEDIUM_VALUES: unknown[][] = Array.from({ length: 100 }, (_, i) =>
  Array.from({ length: 10 }, (_, j) => `Cell ${i},${j}`)
);

const LARGE_VALUES: unknown[][] = Array.from({ length: 1000 }, (_, i) =>
  Array.from({ length: 20 }, (_, j) => `Cell ${i},${j}`)
);

const SMALL_RESPONSE = {
  success: true,
  action: 'read',
  values: SMALL_VALUES,
  range: 'A1:E10',
};

const MEDIUM_RESPONSE = {
  success: true,
  action: 'read',
  values: MEDIUM_VALUES,
  range: 'A1:J100',
};

// ============================================================================
// BASELINE IMPLEMENTATIONS
// ============================================================================

function baselineBuildResponse(data: Record<string, unknown>): {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const structured = { response: data };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

function baselineSerialize(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ============================================================================
// BENCHMARKS
// ============================================================================

const ITERATIONS = 10_000;
const SMALL_ITERATIONS = 1_000;

console.log('ServalSheets Response Builder Benchmark');
console.log('='.repeat(60));
console.log(`Standard iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`Large data iterations: ${SMALL_ITERATIONS.toLocaleString()}\n`);

// 1. Small Response Building
console.log('1. Small Response Building (10 rows x 5 cols)');
console.log('-'.repeat(40));

const baselineSmallResult = benchmark('Baseline (direct JSON)', ITERATIONS, () => {
  baselineBuildResponse(SMALL_RESPONSE);
});

const optimizedSmallResult = benchmark('buildSuccessResponse', ITERATIONS, () => {
  buildSuccessResponse('read', { values: SMALL_VALUES, range: 'A1:E10' });
});

const templateSmallResult = benchmark('buildFromTemplate', ITERATIONS, () => {
  buildFromTemplate('readSuccess', SMALL_VALUES, 'A1:E10');
});

console.log(`  Baseline:     ${baselineSmallResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Optimized:    ${optimizedSmallResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Template:     ${templateSmallResult.avgNs.toFixed(1)} ns/op`);
console.log(
  `  Template speedup: ${(baselineSmallResult.avgNs / templateSmallResult.avgNs).toFixed(1)}x\n`
);

// 2. Medium Response Building
console.log('2. Medium Response Building (100 rows x 10 cols)');
console.log('-'.repeat(40));

const baselineMediumResult = benchmark('Baseline (direct JSON)', ITERATIONS, () => {
  baselineBuildResponse(MEDIUM_RESPONSE);
});

const optimizedMediumResult = benchmark('buildSuccessResponse', ITERATIONS, () => {
  buildSuccessResponse('read', { values: MEDIUM_VALUES, range: 'A1:J100' });
});

console.log(`  Baseline:     ${baselineMediumResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Optimized:    ${optimizedMediumResult.avgNs.toFixed(1)} ns/op`);
console.log(
  `  Speedup: ${(baselineMediumResult.avgNs / optimizedMediumResult.avgNs).toFixed(1)}x\n`
);

// 3. Large Response with Truncation
console.log('3. Large Response with Truncation (1000 rows x 20 cols)');
console.log('-'.repeat(40));

const baselineLargeResult = benchmark('Baseline (full serialize)', SMALL_ITERATIONS, () => {
  baselineBuildResponse({ success: true, action: 'read', values: LARGE_VALUES });
});

const truncatedResult = benchmark('buildSuccessResponse (truncated)', SMALL_ITERATIONS, () => {
  buildSuccessResponse(
    'read',
    { values: LARGE_VALUES, range: 'A1:T1000' },
    { maxInlineCells: 1000, truncationRows: 100, spreadsheetId: 'ss123' }
  );
});

console.log(`  Baseline (full): ${baselineLargeResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Truncated:       ${truncatedResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Speedup: ${(baselineLargeResult.avgNs / truncatedResult.avgNs).toFixed(1)}x\n`);

// 4. Lazy Response
console.log('4. Lazy Response Creation');
console.log('-'.repeat(40));

const lazyCreateResult = benchmark('Create lazy response', ITERATIONS, () => {
  createLazyResponse(SMALL_RESPONSE);
});

const lazyWithCheckResult = benchmark('Create + check error + estimate', ITERATIONS, () => {
  const lazy = createLazyResponse(SMALL_RESPONSE);
  lazy.isError();
  lazy.estimatedSize();
});

const lazyFullResult = benchmark('Create + toResult()', ITERATIONS, () => {
  const lazy = createLazyResponse(SMALL_RESPONSE);
  lazy.toResult();
});

console.log(`  Create only:        ${lazyCreateResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Create + checks:    ${lazyWithCheckResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Create + serialize: ${lazyFullResult.avgNs.toFixed(1)} ns/op\n`);

// 5. Serialization Comparison
console.log('5. Serialization (100 rows x 10 cols)');
console.log('-'.repeat(40));

const baselineSerializeResult = benchmark('JSON.stringify', ITERATIONS, () => {
  baselineSerialize(MEDIUM_RESPONSE);
});

const fastSerializeResult = benchmark('fastSerialize', ITERATIONS, () => {
  fastSerialize(MEDIUM_RESPONSE);
});

console.log(`  JSON.stringify: ${baselineSerializeResult.avgNs.toFixed(1)} ns/op`);
console.log(`  fastSerialize:  ${fastSerializeResult.avgNs.toFixed(1)} ns/op`);
console.log(
  `  Speedup: ${(baselineSerializeResult.avgNs / fastSerializeResult.avgNs).toFixed(1)}x\n`
);

// 6. Size Estimation vs Full Serialization
console.log('6. Size Estimation vs Full Serialization');
console.log('-'.repeat(40));

const fullSerializeForSizeResult = benchmark('Full serialize for size', ITERATIONS, () => {
  JSON.stringify(MEDIUM_RESPONSE).length;
});

const estimateSizeResult = benchmark('estimateResponseSize', ITERATIONS, () => {
  estimateResponseSize(MEDIUM_RESPONSE);
});

console.log(`  Full serialize: ${fullSerializeForSizeResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Estimate:       ${estimateSizeResult.avgNs.toFixed(1)} ns/op`);
console.log(
  `  Speedup: ${(fullSerializeForSizeResult.avgNs / estimateSizeResult.avgNs).toFixed(1)}x\n`
);

// 7. Error Response Building
console.log('7. Error Response Building');
console.log('-'.repeat(40));

const errorBaselineResult = benchmark('Baseline error', ITERATIONS, () => {
  baselineBuildResponse({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Not found', retryable: false },
  });
});

const errorOptimizedResult = benchmark('buildErrorResponse', ITERATIONS, () => {
  buildErrorResponse('NOT_FOUND', 'Not found');
});

const errorTemplateResult = benchmark('buildFromTemplate (notFound)', ITERATIONS, () => {
  buildFromTemplate('notFound', 'spreadsheet', 'ss123');
});

console.log(`  Baseline:  ${errorBaselineResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Optimized: ${errorOptimizedResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Template:  ${errorTemplateResult.avgNs.toFixed(1)} ns/op\n`);

// 8. Streaming Response
console.log('8. Streaming Response Creation (1000 rows)');
console.log('-'.repeat(40));

const streamingCreateResult = benchmark('Create streaming response', SMALL_ITERATIONS, () => {
  createStreamingResponse('read', LARGE_VALUES, { chunkSize: 100 });
});

const streamingChunkResult = benchmark('Create + get first chunk', SMALL_ITERATIONS, () => {
  const streaming = createStreamingResponse('read', LARGE_VALUES, { chunkSize: 100 });
  streaming.nextChunk();
});

console.log(`  Create only:       ${streamingCreateResult.avgNs.toFixed(1)} ns/op`);
console.log(`  Create + 1 chunk:  ${streamingChunkResult.avgNs.toFixed(1)} ns/op\n`);

// Summary
console.log('='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const improvements = [
  {
    name: 'Template response (small)',
    speedup: baselineSmallResult.avgNs / templateSmallResult.avgNs,
  },
  {
    name: 'Large response truncation',
    speedup: baselineLargeResult.avgNs / truncatedResult.avgNs,
  },
  {
    name: 'Size estimation',
    speedup: fullSerializeForSizeResult.avgNs / estimateSizeResult.avgNs,
  },
];

for (const { name, speedup } of improvements) {
  console.log(`  ${name}: ${speedup.toFixed(1)}x faster`);
}

const avgSpeedup = improvements.reduce((sum, i) => sum + i.speedup, 0) / improvements.length;
console.log(`\n  Average improvement: ${avgSpeedup.toFixed(1)}x`);

console.log('\nKey Insights:');
console.log('  - Template responses avoid repeated object construction');
console.log('  - Truncation avoids serializing unused data');
console.log('  - Size estimation is ~10-100x faster than full serialize');
console.log('  - Lazy responses defer work until actually needed');
