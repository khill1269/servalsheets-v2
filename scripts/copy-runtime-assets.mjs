#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT, 'dist');

function resetTarget(targetPath) {
  rmSync(targetPath, { force: true, recursive: true });
  mkdirSync(dirname(targetPath), { recursive: true });
}

function copyPath(sourcePath, targetPath) {
  resetTarget(targetPath);
  cpSync(sourcePath, targetPath, { force: true, recursive: true });
}

function ensureSource(sourcePath) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Required runtime asset is missing: ${sourcePath}`);
  }

  return sourcePath;
}

copyPath(ensureSource(join(ROOT, 'src', 'knowledge')), join(DIST_DIR, 'knowledge'));

for (const fileName of ['auth-error.html', 'auth-success.html']) {
  copyPath(
    ensureSource(join(ROOT, 'src', 'cli', fileName)),
    join(DIST_DIR, 'cli', fileName)
  );
}

for (const fileName of ['dashboard.html', 'dashboard.js', 'styles.css']) {
  copyPath(
    ensureSource(join(ROOT, 'src', 'admin', fileName)),
    join(DIST_DIR, 'admin', fileName)
  );
}

copyPath(
  ensureSource(join(ROOT, 'src', 'security', 'tool-hashes.baseline.json')),
  join(DIST_DIR, 'security', 'tool-hashes.baseline.json')
);

const tracingDashboardSource = join(ROOT, 'src', 'ui', 'tracing-dashboard', 'dist');
if (existsSync(tracingDashboardSource)) {
  copyPath(tracingDashboardSource, join(DIST_DIR, 'ui', 'tracing'));
}
