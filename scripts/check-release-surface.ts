import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ACTION_COUNT, ACTION_COUNTS, TOOL_COUNT } from '../src/schemas/action-counts.ts';

type SurfaceCheck = {
  file: string;
  required?: Array<string | RegExp>;
  forbidden?: Array<string | RegExp>;
};

const ROOT = process.cwd();

const SURFACE_CHECKS: SurfaceCheck[] = [
  {
    file: 'README.md',
    required: [`${TOOL_COUNT} tools`, `${ACTION_COUNT} actions`],
  },
  {
    file: 'docs/index.md',
    required: [`${TOOL_COUNT} tools`, `${ACTION_COUNT} actions`],
  },
  {
    file: 'docs/deployment/index.md',
    required: [`All ${ACTION_COUNT} actions work`, '/health/live', '/health/ready'],
    forbidden: ['`GET /ready`'],
  },
  {
    file: 'docs/deployment/production-launch-checklist.md',
    required: [
      `\`${TOOL_COUNT}\` tools and \`${ACTION_COUNT}\` actions synchronized`,
      'npm run release:audit',
      '/health/ready',
      'docs/security/INCIDENT_RESPONSE_PLAN.md',
    ],
    forbidden: ['`/ready`'],
  },
  {
    file: 'docs/development/PROJECT_STATUS.md',
    required: [
      new RegExp(`\\|\\s*Actions\\s*\\|\\s*${ACTION_COUNT}\\s*\\|`),
      'npm run release:audit',
    ],
  },
  {
    file: 'docs/reference/tools.md',
    required: [`${TOOL_COUNT} MCP tools`, `${ACTION_COUNT} total actions`],
  },
  {
    file: 'docs/security/INCIDENT_RESPONSE_PLAN.md',
    required: ['npm run security:tool-hashes:check', 'Tool Rug-Pull / Description Tampering'],
  },
];

function matchesPattern(content: string, pattern: string | RegExp): boolean {
  return typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
}

function validateSurfaceChecks(): string[] {
  const errors: string[] = [];

  for (const check of SURFACE_CHECKS) {
    const filePath = path.join(ROOT, check.file);
    const content = readFileSync(filePath, 'utf8');

    for (const pattern of check.required ?? []) {
      if (!matchesPattern(content, pattern)) {
        errors.push(`${check.file}: missing ${String(pattern)}`);
      }
    }

    for (const pattern of check.forbidden ?? []) {
      if (matchesPattern(content, pattern)) {
        errors.push(`${check.file}: contains forbidden ${String(pattern)}`);
      }
    }
  }

  return errors;
}

function validateToolsOverview(): string[] {
  const errors: string[] = [];
  const content = readFileSync(path.join(ROOT, 'docs/reference/tools.md'), 'utf8');
  const rows = [...content.matchAll(/^\|\s*`(sheets_[^`]+)`\s*\|\s*(\d+)\s*\|/gm)];
  const observed = new Map(rows.map((match) => [match[1] ?? '', Number(match[2])]));

  for (const [tool, expectedCount] of Object.entries(ACTION_COUNTS)) {
    const observedCount = observed.get(tool);
    if (observedCount === undefined) {
      errors.push(`docs/reference/tools.md: missing table row for ${tool}`);
      continue;
    }

    if (observedCount !== expectedCount) {
      errors.push(
        `docs/reference/tools.md: ${tool} shows ${observedCount} actions (expected ${expectedCount})`
      );
    }
  }

  if (observed.size !== TOOL_COUNT) {
    errors.push(
      `docs/reference/tools.md: expected ${TOOL_COUNT} tool rows but found ${observed.size}`
    );
  }

  return errors;
}

function main(): void {
  const errors = [...validateSurfaceChecks(), ...validateToolsOverview()];

  if (errors.length === 0) {
    console.log(
      `Release surface validation passed (${TOOL_COUNT} tools, ${ACTION_COUNT} actions).`
    );
    return;
  }

  console.error('Release surface validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

main();
