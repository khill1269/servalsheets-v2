import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = resolve(MODULE_DIR, '..');
const PACKAGE_ROOT = resolve(RUNTIME_ROOT, '..');

function uniqueCandidates(candidates: string[]): string[] {
  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

export function resolveExistingPath(candidates: string[]): string | null {
  for (const candidate of uniqueCandidates(candidates)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveBuiltinTemplatesPath(): string | null {
  return resolveExistingPath([
    join(RUNTIME_ROOT, 'knowledge', 'templates'),
    join(PACKAGE_ROOT, 'dist', 'knowledge', 'templates'),
    join(PACKAGE_ROOT, 'src', 'knowledge', 'templates'),
    join(process.cwd(), 'dist', 'knowledge', 'templates'),
    join(process.cwd(), 'src', 'knowledge', 'templates'),
  ]);
}

export function resolveGuidesDirectory(): string | null {
  return resolveExistingPath([
    join(PACKAGE_ROOT, 'docs', 'guides'),
    join(process.cwd(), 'docs', 'guides'),
  ]);
}

export function resolveOpenApiJsonPath(): string | null {
  return resolveExistingPath([
    join(PACKAGE_ROOT, 'openapi.json'),
    join(process.cwd(), 'openapi.json'),
  ]);
}

export function resolveOpenApiYamlPath(): string | null {
  return resolveExistingPath([
    join(PACKAGE_ROOT, 'openapi.yaml'),
    join(process.cwd(), 'openapi.yaml'),
  ]);
}

export function resolveToolHashBaselinePath(): string | null {
  return resolveExistingPath([
    join(RUNTIME_ROOT, 'security', 'tool-hashes.baseline.json'),
    join(PACKAGE_ROOT, 'dist', 'security', 'tool-hashes.baseline.json'),
    join(PACKAGE_ROOT, 'src', 'security', 'tool-hashes.baseline.json'),
    join(process.cwd(), 'dist', 'security', 'tool-hashes.baseline.json'),
    join(process.cwd(), 'src', 'security', 'tool-hashes.baseline.json'),
  ]);
}

export function resolveTracingDashboardPath(): string | null {
  return resolveExistingPath([
    join(RUNTIME_ROOT, 'ui', 'tracing'),
    join(PACKAGE_ROOT, 'dist', 'ui', 'tracing'),
    join(PACKAGE_ROOT, 'src', 'ui', 'tracing-dashboard', 'dist'),
    join(process.cwd(), 'dist', 'ui', 'tracing'),
    join(process.cwd(), 'src', 'ui', 'tracing-dashboard', 'dist'),
  ]);
}
