import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import { MutationVerifier } from '../../src/services/mutation-verifier.js';

function createSheetsApi(values: unknown[][]) {
  return {
    spreadsheets: {
      values: {
        get: vi.fn().mockResolvedValue({ data: { values } }),
      },
      get: vi.fn().mockResolvedValue({ data: { sheets: [] } }),
    },
  } as const;
}

describe('MutationVerifier', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTest();
  });

  it('returns a diverged result by default when verification mismatches are found', async () => {
    vi.stubEnv('MUTATION_VERIFY_STRICT', 'false');
    resetEnvForTest();

    const verifier = new MutationVerifier(createSheetsApi([['unexpected']]) as never);

    await expect(
      verifier.verifyWrite({
        spreadsheetId: 'sheet-1',
        range: 'Sheet1!A1',
        expectedValues: [['expected']],
      })
    ).resolves.toMatchObject({
      status: 'diverged',
      operation: 'write',
    });
  });

  it('throws when strict verification is enabled and read-back diverges', async () => {
    vi.stubEnv('MUTATION_VERIFY_STRICT', 'true');
    resetEnvForTest();

    const verifier = new MutationVerifier(createSheetsApi([['unexpected']]) as never);

    await expect(
      verifier.verifyWrite({
        spreadsheetId: 'sheet-1',
        range: 'Sheet1!A1',
        expectedValues: [['expected']],
      })
    ).rejects.toThrow(/Mutation verification diverged/);
  });
});
