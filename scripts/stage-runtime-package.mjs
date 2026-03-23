#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirArg = process.argv[2];
const bundleRootFlagIndex = process.argv.indexOf('--bundle-root');
const bundleRootArg =
  bundleRootFlagIndex === -1 ? null : process.argv[bundleRootFlagIndex + 1] || null;

if (!outputDirArg) {
  console.error('Usage: node scripts/stage-runtime-package.mjs <output-dir> [--bundle-root <dir>]');
  process.exit(1);
}

const outputDir = resolve(ROOT, outputDirArg);
const bundleRoot = bundleRootArg ? resolve(ROOT, bundleRootArg) : null;
mkdirSync(outputDir, { recursive: true });

function ensureExists(path) {
  if (!existsSync(path)) {
    throw new Error(`Required path is missing: ${path}`);
  }
  return path;
}

function copyIntoOutput(sourceRelativePath, targetRelativePath) {
  const sourcePath = ensureExists(join(ROOT, sourceRelativePath));
  const targetPath = join(outputDir, targetRelativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { force: true, recursive: true });
}

const rootPackageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

const runtimePackageJson = {
  name: `${rootPackageJson.name}-runtime`,
  version: rootPackageJson.version,
  description: rootPackageJson.description,
  type: rootPackageJson.type,
  main: rootPackageJson.main,
  bin: rootPackageJson.bin,
  exports: rootPackageJson.exports,
  engines: rootPackageJson.engines,
  dependencies: {
    ...rootPackageJson.dependencies,
    '@serval/core': 'file:packages/serval-core',
  },
  optionalDependencies: rootPackageJson.optionalDependencies,
  overrides: rootPackageJson.overrides,
};

writeFileSync(join(outputDir, 'package.json'), JSON.stringify(runtimePackageJson, null, 2) + '\n');

copyIntoOutput('dist', 'dist');
copyIntoOutput('docs/guides', 'docs/guides');
copyIntoOutput('server.json', 'server.json');
copyIntoOutput('openapi.json', 'openapi.json');
copyIntoOutput('openapi.yaml', 'openapi.yaml');

copyIntoOutput('packages/serval-core/package.json', 'packages/serval-core/package.json');
copyIntoOutput('packages/serval-core/dist', 'packages/serval-core/dist');

if (bundleRoot) {
  const bundleManifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
  bundleManifest.icon = 'icon.png';

  mkdirSync(bundleRoot, { recursive: true });
  writeFileSync(join(bundleRoot, 'manifest.json'), JSON.stringify(bundleManifest, null, 2) + '\n');
  cpSync(
    ensureExists(join(ROOT, 'assets', 'servalsheets-logo-512.png')),
    join(bundleRoot, 'icon.png'),
    { force: true }
  );
}
