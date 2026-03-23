#!/usr/bin/env node
/**
 * ServalSheets Audit Report Generator
 *
 * Reads audit-output/results.json and generates a comprehensive
 * markdown report in the style of docs/analysis/REPORT.md
 */

import fs from 'fs';
import path from 'path';

const RESULTS_FILE = path.join('audit-output', 'results.json');
const REPORT_FILE = path.join('audit-output', 'REPORT.md');

console.log('═══════════════════════════════════════════════════════════');
console.log('   ServalSheets Audit Report Generator');
console.log('═══════════════════════════════════════════════════════════\n');

// Load results
if (!fs.existsSync(RESULTS_FILE)) {
  console.error(`❌ Results file not found: ${RESULTS_FILE}`);
  console.error('   Run: npm run audit:full');
  process.exit(1);
}

console.log(`▶ Reading results from ${RESULTS_FILE}...`);
const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

// Calculate section scores
const categoriesByPart = {
  Functional: results.categories.filter((c) => c.part === 'Functional'),
  Protocol: results.categories.filter((c) => c.part === 'Protocol'),
  Quality: results.categories.filter((c) => c.part === 'Quality'),
  DeepTech: results.categories.filter((c) => c.part === 'DeepTech'),
  Excellence: results.categories.filter((c) => c.part === 'Excellence'),
  Execution: results.categories.filter((c) => c.part === 'Execution'),
};

const calculatePartScore = (categories) => {
  if (categories.length === 0) return { score: 0, max: 0, percentage: 0 };
  const score = categories.reduce((sum, cat) => sum + cat.score, 0);
  const max = categories.length * 10;
  return { score, max, percentage: Math.round((score / max) * 100 * 100) / 100 };
};

const partScores = {
  functional: calculatePartScore(categoriesByPart.Functional),
  protocol: calculatePartScore(categoriesByPart.Protocol),
  quality: calculatePartScore(categoriesByPart.Quality),
  deepTech: calculatePartScore(categoriesByPart.DeepTech),
  excellence: calculatePartScore(categoriesByPart.Excellence),
};

// Generate report
console.log('▶ Generating markdown report...\n');

const report = `# ServalSheets v${results.version} — 106-Category Audit Report

**Date:** ${new Date(results.timestamp).toISOString().split('T')[0]}
**Analyzer:** Automated Audit Framework
**Version:** ${results.version}
**Duration:** ~5-10 minutes

---

## Executive Summary

**Overall Score: ${results.total_percentage}% / 140%**

| Section                        | Score  | Max    |
| ------------------------------ | ------ | ------ |
| Part 1: Functional (cats 1-12) | ${partScores.functional.percentage}% | 46%    |
| Part 2: Protocol (cats 13-16)  | ${partScores.protocol.percentage}% | 18%    |
| Part 3: Code Quality (17-32)   | ${partScores.quality.percentage}% | 36%    |
| Part 4: Deep Technical (Bonus) | ${partScores.deepTech.percentage}% | +20%   |
| Part 5: Excellence (Bonus)     | ${partScores.excellence.percentage}% | +20%   |
| **Total**                      | **${results.total_percentage}%** | **140%** |

### Verdict

ServalSheets v${results.version} scores **${results.total_percentage}%** placing it in the ${getVerdict(results.total_percentage)} tier. ${results.issues.filter((i) => i.priority === 'P0').length === 0 ? 'No P0 (critical) issues remain.' : `⚠️ ${results.issues.filter((i) => i.priority === 'P0').length} critical issues require immediate attention.`}

---

## Part 1: Functional Features (46%)

| #  | Category      | Score | Status |
| -- | ------------- | ----- | ------ |
${categoriesByPart.Functional.map((cat) => `| ${cat.id}  | ${cat.name.padEnd(40)} | ${cat.score}/10 | ${getStatus(cat.score)} |`).join('\n')}

**Subtotal:** ${partScores.functional.score}/${partScores.functional.max} = ${partScores.functional.percentage}%

---

## Part 2: Protocol Compliance (18%)

| #  | Category   | Score | Status |
| -- | ---------- | ----- | ------ |
${categoriesByPart.Protocol.map((cat) => `| ${cat.id}  | ${cat.name.padEnd(40)} | ${cat.score}/10 | ${getStatus(cat.score)} |`).join('\n')}

**Subtotal:** ${partScores.protocol.score}/${partScores.protocol.max} = ${partScores.protocol.percentage}%

---

## Part 3: Code Quality (36%)

| #  | Category              | Score | Status |
| -- | --------------------- | ----- | ------ |
${categoriesByPart.Quality.map((cat) => `| ${cat.id}  | ${cat.name.padEnd(40)} | ${cat.score}/10 | ${getStatus(cat.score)} |`).join('\n')}

**Subtotal:** ${partScores.quality.score}/${partScores.quality.max} = ${partScores.quality.percentage}%

---

## Part 4: Deep Technical (Bonus +20%)

Categories 33-60 (28 categories)

**Average Score:** ${Math.round((partScores.deepTech.score / categoriesByPart.DeepTech.length) * 10) / 10}/10
**Subtotal:** ${partScores.deepTech.percentage}%

---

## Part 5: Excellence (Bonus +20%)

Categories 61-80 (20 categories)

**Average Score:** ${Math.round((partScores.excellence.score / categoriesByPart.Excellence.length) * 10) / 10}/10
**Subtotal:** ${partScores.excellence.percentage}%

---

## Part 6: Execution Verification (Pass/Fail Gates)

| Cat | Description       | Result       |
| --- | ----------------- | ------------ |
${categoriesByPart.Execution.slice(0, 16)
  .map((cat) => `| ${cat.id}  | ${cat.name.padEnd(30)} | ${cat.passed ? '**PASS**' : '**FAIL**'} |`)
  .join('\n')}

**Pass Rate:** ${categoriesByPart.Execution.filter((c) => c.passed).length}/${categoriesByPart.Execution.length} (${Math.round((categoriesByPart.Execution.filter((c) => c.passed).length / categoriesByPart.Execution.length) * 100)}%)

---

## Issues Summary

**Total Issues:** ${results.issues.length}

### By Priority

- **P0 (Critical):** ${results.issues.filter((i) => i.priority === 'P0').length}
- **P1 (High):** ${results.issues.filter((i) => i.priority === 'P1').length}
- **P2 (Medium):** ${results.issues.filter((i) => i.priority === 'P2').length}
- **P3 (Low):** ${results.issues.filter((i) => i.priority === 'P3').length}

${results.issues.length > 0 ? '### Issues List\n\n' + results.issues.map((issue, i) => `${i + 1}. **[${issue.priority}]** ${issue.category}: ${issue.description}`).join('\n') : '✅ No issues identified'}

---

## Recommendations

${getRecommendations(results)}

---

## Conclusion

ServalSheets v${results.version} achieves a score of **${results.total_percentage}% out of 140%** (${Math.round(results.total_percentage / 1.4)}% of maximum), placing it firmly in the **"${getVerdict(results.total_percentage)}"** tier.

${
  results.issues.filter((i) => i.priority === 'P0').length === 0
    ? 'The project is production-ready with no critical issues.'
    : `⚠️ ${results.issues.filter((i) => i.priority === 'P0').length} critical issue(s) must be addressed before production deployment.`
}

---

**Report Generated:** ${new Date().toISOString()}
**Audit Framework:** Automated 106-Category Analysis
**Next Audit:** ${getNextAuditDate(results.timestamp)}
`;

// Helper functions
function getStatus(score) {
  if (score >= 9) return '✅';
  if (score >= 7) return '⚠️';
  return '❌';
}

function getVerdict(percentage) {
  if (percentage >= 135) return 'Exceptional — World-Class';
  if (percentage >= 130) return 'Excellent — Production Ready';
  if (percentage >= 120) return 'Very Good — Near Production';
  if (percentage >= 100) return 'Good — Functional';
  if (percentage >= 80) return 'Fair — Needs Work';
  return 'Poor — Major Issues';
}

function getRecommendations(results) {
  const recs = [];

  if (results.issues.filter((i) => i.priority === 'P0').length > 0) {
    recs.push('### Immediate (This Week)\n');
    results.issues
      .filter((i) => i.priority === 'P0')
      .forEach((issue) => {
        recs.push(`- Fix ${issue.category}: ${issue.description}`);
      });
  }

  if (results.issues.filter((i) => i.priority === 'P1').length > 0) {
    recs.push('\n### Short-term (This Month)\n');
    results.issues
      .filter((i) => i.priority === 'P1')
      .forEach((issue) => {
        recs.push(`- Address ${issue.category}: ${issue.description}`);
      });
  }

  if (recs.length === 0) {
    return '✅ No critical recommendations. Focus on maintaining current quality standards.';
  }

  return recs.join('\n');
}

function getNextAuditDate(timestamp) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + 7); // Weekly
  return date.toISOString().split('T')[0];
}

// Write report
fs.writeFileSync(REPORT_FILE, report);

console.log(`✓ Report generated: ${REPORT_FILE}`);
console.log(`\n══════════════════════════════════════════════════════`);
console.log(`   Final Score: ${results.total_percentage}%`);
console.log(`   Verdict: ${getVerdict(results.total_percentage)}`);
console.log(
  `   Issues: ${results.issues.length} (${results.issues.filter((i) => i.priority === 'P0').length} critical)`
);
console.log(`══════════════════════════════════════════════════════\n`);
