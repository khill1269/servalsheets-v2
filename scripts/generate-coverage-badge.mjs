#!/usr/bin/env node

/**
 * Generate coverage badge based on coverage-summary.json
 * Outputs a badge URL that can be used in README
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const COVERAGE_FILE = 'coverage/coverage-summary.json';
const BADGE_FILE = 'coverage/badge.svg';

// Badge colors based on coverage percentage
function getBadgeColor(percentage) {
  if (percentage >= 90) return 'brightgreen';
  if (percentage >= 80) return 'green';
  if (percentage >= 70) return 'yellow';
  if (percentage >= 60) return 'orange';
  return 'red';
}

// Generate shields.io badge URL
function generateBadgeUrl(percentage) {
  const color = getBadgeColor(percentage);
  return `https://img.shields.io/badge/coverage-${percentage}%25-${color}`;
}

// Generate SVG badge content
function generateBadgeSvg(percentage) {
  const color = getBadgeColor(percentage);
  const colorHex = {
    brightgreen: '#4c1',
    green: '#97ca00',
    yellow: '#dfb317',
    orange: '#fe7d37',
    red: '#e05d44',
  }[color];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="96" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h61v20H0z"/>
    <path fill="${colorHex}" d="M61 0h35v20H61z"/>
    <path fill="url(#b)" d="M0 0h96v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="30.5" y="15" fill="#010101" fill-opacity=".3">coverage</text>
    <text x="30.5" y="14">coverage</text>
    <text x="77.5" y="15" fill="#010101" fill-opacity=".3">${percentage}%</text>
    <text x="77.5" y="14">${percentage}%</text>
  </g>
</svg>`;
}

try {
  // Check if coverage file exists
  if (!existsSync(COVERAGE_FILE)) {
    console.error('❌ Coverage summary not found. Run: npm run test:coverage');
    process.exit(1);
  }

  // Read coverage summary
  const coverageData = JSON.parse(readFileSync(COVERAGE_FILE, 'utf-8'));
  const totalCoverage = coverageData.total;

  // Calculate average coverage across all metrics
  const avgCoverage = Math.round(
    (totalCoverage.lines.pct +
      totalCoverage.statements.pct +
      totalCoverage.functions.pct +
      totalCoverage.branches.pct) /
      4
  );

  console.log('\n📊 Coverage Summary:');
  console.log(`  Lines:      ${totalCoverage.lines.pct.toFixed(2)}%`);
  console.log(`  Statements: ${totalCoverage.statements.pct.toFixed(2)}%`);
  console.log(`  Functions:  ${totalCoverage.functions.pct.toFixed(2)}%`);
  console.log(`  Branches:   ${totalCoverage.branches.pct.toFixed(2)}%`);
  console.log(`  Average:    ${avgCoverage}%\n`);

  // Generate badge
  const badgeSvg = generateBadgeSvg(avgCoverage);
  writeFileSync(BADGE_FILE, badgeSvg);

  console.log(`✅ Coverage badge generated: ${BADGE_FILE}`);
  console.log(`\n📋 Badge URL for README:`);
  console.log(`![Coverage](${generateBadgeUrl(avgCoverage)})`);
  console.log(`\n📋 Or use local badge:`);
  console.log(`![Coverage](./coverage/badge.svg)\n`);

  // Check thresholds
  const thresholds = {
    lines: 75,
    functions: 75,
    branches: 70,
    statements: 75,
  };

  let failed = false;
  for (const [metric, threshold] of Object.entries(thresholds)) {
    if (totalCoverage[metric].pct < threshold) {
      console.error(
        `❌ ${metric} coverage (${totalCoverage[metric].pct.toFixed(2)}%) below threshold (${threshold}%)`
      );
      failed = true;
    }
  }

  if (failed) {
    console.error('\n❌ Coverage thresholds not met');
    process.exit(1);
  }

  console.log('✅ All coverage thresholds met');
} catch (error) {
  console.error('❌ Error generating coverage badge:', error.message);
  process.exit(1);
}
