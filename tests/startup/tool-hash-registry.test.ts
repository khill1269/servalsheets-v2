import { describe, expect, it } from 'vitest';
import { generateToolHashManifest, hashTool } from '../../src/security/tool-hash-registry.js';
import { TOOL_DESCRIPTIONS } from '../../src/schemas/descriptions.js';
import { TOOL_DESCRIPTIONS_MINIMAL } from '../../src/schemas/descriptions-minimal.js';

describe('tool hash registry', () => {
  it('records both full and minimal description hashes for transport-dependent tools', async () => {
    const manifest = await generateToolHashManifest('test');
    const entry = manifest.tools['sheets_auth'];

    expect(entry).toBeDefined();

    const acceptedHashes = new Set([entry!.sha256, ...(entry!.allowedSha256 ?? [])]);
    const fullHash = hashTool('sheets_auth', TOOL_DESCRIPTIONS['sheets_auth']!);
    const minimalHash = hashTool('sheets_auth', TOOL_DESCRIPTIONS_MINIMAL['sheets_auth']!);

    expect(acceptedHashes.has(fullHash)).toBe(true);
    expect(acceptedHashes.has(minimalHash)).toBe(true);
  });
});
