import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import {
  resolveBuiltinTemplatesPath,
  resolveGuidesDirectory,
  resolveOpenApiJsonPath,
  resolveOpenApiYamlPath,
  resolveToolHashBaselinePath,
  resolveTracingDashboardPath,
} from '../../src/utils/runtime-paths.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

function normalizePath(value: string | null): string | null {
  return value?.replace(/\\/g, '/').replace(/\/+/g, '/');
}

describe('runtime path resolution', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('prefers built-in template directories relative to the runtime module', () => {
    vi.mocked(existsSync).mockImplementation((candidate) =>
      normalizePath(String(candidate))?.endsWith('/src/knowledge/templates') ?? false
    );

    expect(normalizePath(resolveBuiltinTemplatesPath())).toMatch(/\/src\/knowledge\/templates$/);
  });

  it('resolves packaged guide directories without relying on cwd', () => {
    vi.mocked(existsSync).mockImplementation((candidate) =>
      normalizePath(String(candidate))?.endsWith('/docs/guides') ?? false
    );

    expect(normalizePath(resolveGuidesDirectory())).toMatch(/\/docs\/guides$/);
  });

  it('resolves OpenAPI specs from the package root', () => {
    vi.mocked(existsSync).mockImplementation((candidate) => {
      const normalized = normalizePath(String(candidate));
      return normalized?.endsWith('/openapi.json') || normalized?.endsWith('/openapi.yaml') || false;
    });

    expect(normalizePath(resolveOpenApiJsonPath())).toMatch(/\/openapi\.json$/);
    expect(normalizePath(resolveOpenApiYamlPath())).toMatch(/\/openapi\.yaml$/);
  });

  it('falls back to the source tracing dashboard build when dist assets are absent', () => {
    vi.mocked(existsSync).mockImplementation((candidate) =>
      normalizePath(String(candidate))?.endsWith('/src/ui/tracing-dashboard/dist') ?? false
    );

    expect(normalizePath(resolveTracingDashboardPath())).toMatch(
      /\/src\/ui\/tracing-dashboard\/dist$/
    );
  });

  it('resolves the tool hash baseline from runtime assets', () => {
    vi.mocked(existsSync).mockImplementation((candidate) =>
      normalizePath(String(candidate))?.endsWith('/src/security/tool-hashes.baseline.json') ??
      false
    );

    expect(normalizePath(resolveToolHashBaselinePath())).toMatch(
      /\/src\/security\/tool-hashes\.baseline\.json$/
    );
  });
});
