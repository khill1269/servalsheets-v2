import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '../..');
const scriptPath = resolve(projectRoot, 'scripts/validate-mcp-protocol.sh');

describe('validate-mcp-protocol.sh', () => {
  it('passes against current schema and test layout', () => {
    const result = spawnSync('bash', [scriptPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        VALIDATE_MCP_PROTOCOL_SKIP_TESTS: 'true',
      },
    });

    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    expect(result.status, combinedOutput).toBe(0);
    expect(combinedOutput).toContain('MCP protocol validation passed.');
  });
});
