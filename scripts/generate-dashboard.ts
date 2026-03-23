#!/usr/bin/env tsx
/**
 * ServalSheets Dashboard Generator
 *
 * Generates an interactive HTML dashboard from audit results
 * - Reads current audit results from audit-output/results.json
 * - Reads historical results from Git
 * - Generates dashboard/index.html with embedded data
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const RESULTS_FILE = 'audit-output/results.json';
const TEMPLATE_FILE = 'dashboard/template.html';
const OUTPUT_FILE = 'dashboard/index.html';

console.log('═══════════════════════════════════════════════════════════');
console.log('   ServalSheets Dashboard Generator');
console.log('═══════════════════════════════════════════════════════════\n');

// Check if results exist
if (!fs.existsSync(RESULTS_FILE)) {
  console.error(`❌ Error: Results file not found: ${RESULTS_FILE}`);
  console.error('   Run: npm run audit:full');
  process.exit(1);
}

// Load current results
console.log('▶ Loading current audit results...');
const currentResults = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

// Calculate category scores
interface CategoryScores {
  functional: number;
  protocol: number;
  quality: number;
  deepTech: number;
  excellence: number;
  execution: number;
}

function calculateCategoryScores(results: any): CategoryScores {
  const byPart: Record<string, any[]> = {};

  results.categories.forEach((cat: any) => {
    if (!byPart[cat.part]) byPart[cat.part] = [];
    byPart[cat.part].push(cat);
  });

  const calcScore = (cats: any[]) => {
    if (!cats || cats.length === 0) return 0;
    const sum = cats.reduce((acc, cat) => acc + (cat.score || 0), 0);
    return Math.round((sum / (cats.length * 10)) * 100 * 100) / 100;
  };

  return {
    functional: calcScore(byPart.Functional),
    protocol: calcScore(byPart.Protocol),
    quality: calcScore(byPart.Quality),
    deepTech: calcScore(byPart.DeepTech),
    excellence: calcScore(byPart.Excellence),
    execution: calcScore(byPart.Execution),
  };
}

const categoryScores = calculateCategoryScores(currentResults);

// Load historical results from Git
console.log('▶ Loading historical audit results from Git...');
const history: any[] = [];

try {
  // Get list of commits that modified results.json
  const commits = execSync('git log --all --format="%H %ct" -- audit-output/results.json', {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // Load up to 10 historical results
  for (const commit of commits.slice(0, 10)) {
    const [hash, timestamp] = commit.split(' ');

    try {
      const fileContent = execSync(`git show ${hash}:audit-output/results.json`, {
        encoding: 'utf8',
      });

      const historicalResult = JSON.parse(fileContent);
      history.push({
        timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
        total_percentage: historicalResult.total_percentage,
        commit: hash.substring(0, 7),
      });
    } catch (err) {
      // Skip if file doesn't exist in this commit
      continue;
    }
  }
} catch (err) {
  console.log('  ⚠️  No Git history found, using current results only');
}

// If no history, add current as single point
if (history.length === 0) {
  history.push({
    timestamp: currentResults.timestamp,
    total_percentage: currentResults.total_percentage,
    commit: 'current',
  });
}

// Reverse to get chronological order
history.reverse();

console.log(`  ✓ Loaded ${history.length} historical results`);

// Build dashboard data
const dashboardData = {
  current: {
    timestamp: currentResults.timestamp,
    total_percentage: currentResults.total_percentage,
    functional: categoryScores.functional,
    protocol: categoryScores.protocol,
    quality: categoryScores.quality,
    deepTech: categoryScores.deepTech,
    excellence: categoryScores.excellence,
    execution: categoryScores.execution,
    issues: currentResults.issues || [],
  },
  history: history,
};

// Load template
console.log('▶ Loading dashboard template...');
if (!fs.existsSync(TEMPLATE_FILE)) {
  console.error(`❌ Error: Template file not found: ${TEMPLATE_FILE}`);
  process.exit(1);
}

let template = fs.readFileSync(TEMPLATE_FILE, 'utf8');

// Inject data
console.log('▶ Injecting dashboard data...');
const dataString = JSON.stringify(dashboardData, null, 2);
template = template.replace('{{DASHBOARD_DATA}}', dataString);

// Write output
console.log('▶ Writing dashboard...');
fs.writeFileSync(OUTPUT_FILE, template);

console.log(`\n✓ Dashboard generated: ${OUTPUT_FILE}`);
console.log(`  Current Score: ${currentResults.total_percentage}%`);
console.log(`  Historical Points: ${history.length}`);
console.log(`  Issues: ${currentResults.issues.length}`);

// Open in browser (optional)
if (process.argv.includes('--open')) {
  try {
    execSync(`open ${OUTPUT_FILE}`);
    console.log('  ✓ Opened in browser');
  } catch (err) {
    console.log('  (Could not open browser automatically)');
  }
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('   Dashboard Ready');
console.log('═══════════════════════════════════════════════════════════\n');
