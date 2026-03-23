#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/summarize-hotspot-analysis.mjs <input> <output>');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const byAgent = new Map();
const byDimension = new Map();
const byFile = new Map();
const byMessage = new Map();

for (const agentReport of report.agentReports ?? []) {
  const agentIssueCount = (agentReport.dimensionReports ?? []).reduce(
    (total, dimensionReport) => total + (dimensionReport.issueCount ?? 0),
    0
  );

  byAgent.set(agentReport.agentName, (byAgent.get(agentReport.agentName) ?? 0) + agentIssueCount);

  for (const dimensionReport of agentReport.dimensionReports ?? []) {
    const dimensionKey = `${agentReport.agentName}:${dimensionReport.dimension}`;
    byDimension.set(
      dimensionKey,
      (byDimension.get(dimensionKey) ?? 0) + (dimensionReport.issueCount ?? 0)
    );

    for (const issue of dimensionReport.issues ?? []) {
      byFile.set(issue.file, (byFile.get(issue.file) ?? 0) + 1);

      const message = String(issue.message ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      byMessage.set(message, (byMessage.get(message) ?? 0) + 1);
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  totalFiles: (report.files ?? []).length,
  totals: report.summary ?? {},
  topAgents: topEntries(byAgent, 5),
  topDimensions: topEntries(byDimension, 5),
  topFiles: topEntries(byFile, 10).map(({ key, count }) => ({
    file: path.relative(process.cwd(), key),
    count,
  })),
  topMessages: topEntries(byMessage, 10).map(({ key, count }) => ({
    message: key,
    count,
  })),
};

fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log('Hotspot summary');
console.log(`- Total issues: ${summary.totals.totalIssues ?? 0}`);
console.log(
  `- Top agent: ${summary.topAgents[0]?.key ?? 'none'} (${summary.topAgents[0]?.count ?? 0})`
);
console.log(
  `- Top file: ${summary.topFiles[0]?.file ?? 'none'} (${summary.topFiles[0]?.count ?? 0})`
);
