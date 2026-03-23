import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '../..');
const scriptPath = resolve(projectRoot, 'scripts/check-source-dist-consistency.ts');

describe('check-source-dist-consistency.ts', () => {
  it('supports dev mode when dist artifacts are missing', () => {
    const env = { ...process.env, NODE_ENV: 'test' };
    const result = spawnSync('node', ['--import', 'tsx', scriptPath, '--allow-missing-dist'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    expect(result.status, output).toBe(0);
    expect(output).toMatch(/Source\/dist consistency (passed|skipped)/i);
  });

  it('runs strict mode consistency checks when dist artifacts exist', () => {
    const hasDistArtifacts =
      existsSync(resolve(projectRoot, 'dist/schemas/action-counts.js')) &&
      existsSync(resolve(projectRoot, 'dist/mcp/completions.js'));

    const env = { ...process.env, NODE_ENV: 'test' };
    const result = spawnSync('node', ['--import', 'tsx', scriptPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env,
    });

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    if (hasDistArtifacts) {
      expect(result.status, output).toBe(0);
      expect(output).toContain('Source/dist consistency passed.');
    } else {
      expect(result.status, output).toBe(1);
      expect(output).toContain('dist artifacts are missing');
    }
  });
});
