#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const errors = [];
const warnings = [];

function stripJsonc(source) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    if (char === '/' && nextChar === '*') {
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, '$1');
}

function readJsonFile(relativePath, allowJsonc = false) {
  const absolutePath = path.join(repoRoot, relativePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(allowJsonc ? stripJsonc(raw) : raw);
}

function parseMajor(versionLike) {
  if (typeof versionLike !== 'string') return null;
  const match = versionLike.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseEngineMinMajor(engineSpec) {
  if (typeof engineSpec !== 'string') return null;
  const match = engineSpec.match(/>=\s*(\d+)/);
  if (match) return Number(match[1]);
  return parseMajor(engineSpec);
}

function parseDevcontainerNodeMajor(image) {
  if (typeof image !== 'string' || image.length === 0) return null;
  const [, tag = ''] = image.split(':');
  if (!tag) return null;

  const numericSegments = tag
    .split(/[-_.]/)
    .map((segment) => Number(segment))
    .filter((value) => Number.isInteger(value));

  if (numericSegments.length === 0) return null;

  const realisticNode = numericSegments.find((value) => value >= 16);
  return realisticNode ?? numericSegments[0] ?? null;
}

function resolveNodeVersionReference(workflowText, rawValue) {
  if (!rawValue.includes('${{')) return rawValue;
  if (!rawValue.includes('env.NODE_VERSION')) return null;

  const envMatch = workflowText.match(/NODE_VERSION:\s*['"]?([^'"\n]+)['"]?/);
  if (!envMatch) return null;
  return envMatch[1]?.trim() ?? null;
}

const packageJson = readJsonFile('package.json');
const devcontainerJson = readJsonFile('.devcontainer/devcontainer.json', true);

const engineSpec = packageJson.engines?.node ?? '';
const engineMinMajor = parseEngineMinMajor(engineSpec);
const devcontainerNodeMajor = parseDevcontainerNodeMajor(devcontainerJson.image);

if (engineMinMajor === null) {
  errors.push('Unable to parse package.json engines.node minimum major version.');
}

if (devcontainerNodeMajor === null) {
  errors.push(
    `Unable to parse Node major version from .devcontainer image "${devcontainerJson.image}".`
  );
}

if (
  engineMinMajor !== null &&
  devcontainerNodeMajor !== null &&
  devcontainerNodeMajor < engineMinMajor
) {
  errors.push(
    `.devcontainer Node major ${devcontainerNodeMajor} is below engines.node minimum ${engineMinMajor}.`
  );
}

const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const workflowFiles = fs
  .readdirSync(workflowsDir)
  .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
  .sort();

const discoveredVersions = [];

for (const fileName of workflowFiles) {
  const workflowPath = path.join(workflowsDir, fileName);
  const workflowText = fs.readFileSync(workflowPath, 'utf8');
  const matches = workflowText.matchAll(/node-version:\s*['"]?([^'"\n]+)['"]?/g);

  for (const match of matches) {
    const rawValue = match[1]?.trim() ?? '';
    const resolvedValue = resolveNodeVersionReference(workflowText, rawValue);

    if (!resolvedValue) {
      warnings.push(
        `${fileName}: unable to resolve node-version expression "${rawValue}" (skipping parity check for this entry).`
      );
      continue;
    }

    const major = parseMajor(resolvedValue);
    if (major === null) {
      warnings.push(
        `${fileName}: could not parse node-version "${resolvedValue}" (from "${rawValue}").`
      );
      continue;
    }

    discoveredVersions.push({ fileName, rawValue, resolvedValue, major });
  }
}

if (discoveredVersions.length === 0) {
  errors.push('No parseable node-version entries were found in .github/workflows.');
}

for (const entry of discoveredVersions) {
  if (engineMinMajor !== null && entry.major < engineMinMajor) {
    errors.push(
      `${entry.fileName}: node-version ${entry.resolvedValue} is below engines.node minimum ${engineMinMajor}.`
    );
  }

  if (devcontainerNodeMajor !== null && entry.major !== devcontainerNodeMajor) {
    errors.push(
      `${entry.fileName}: node-version ${entry.resolvedValue} does not match .devcontainer Node major ${devcontainerNodeMajor}.`
    );
  }
}

console.log('Devcontainer/CI parity report');
console.log('============================');
console.log(`engines.node: ${engineSpec || '(missing)'}`);
console.log(`.devcontainer image: ${devcontainerJson.image || '(missing)'}`);
console.log(`workflow files scanned: ${workflowFiles.length}`);
console.log(`node-version entries checked: ${discoveredVersions.length}`);

if (warnings.length > 0) {
  console.log('');
  console.log('Warnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  console.log('');
  console.error('Parity errors:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('');
console.log(
  `Parity check passed: all workflow node-version entries align with .devcontainer Node ${devcontainerNodeMajor}.`
);
