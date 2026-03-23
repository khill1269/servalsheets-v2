import { describe, it, expect } from 'vitest';
import {
  parseAddedSpreadsheetGetCalls,
  hasFieldsMaskOrAllowlist,
  findFieldsMaskViolations,
} from '../../scripts/check-sheets-fields-mask.ts';

describe('sheets fields-mask guard', () => {
  it('parses added spreadsheets.get calls from git diff hunks', () => {
    const diff = [
      'diff --git a/src/example.ts b/src/example.ts',
      'index 1111111..2222222 100644',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -10,0 +11,4 @@',
      '+const response = await sheetsApi.spreadsheets.get({',
      '+  spreadsheetId,',
      '+});',
    ].join('\n');

    const calls = parseAddedSpreadsheetGetCalls(diff);
    expect(calls).toEqual([{ filePath: 'src/example.ts', lineNumber: 11 }]);
  });

  it('accepts snippets with fields masks or allowlist marker', () => {
    expect(
      hasFieldsMaskOrAllowlist(`await api.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId' });`)
    ).toBe(true);
    expect(
      hasFieldsMaskOrAllowlist(
        `// fields-mask-allowlist\nawait api.spreadsheets.get({ spreadsheetId });`
      )
    ).toBe(true);
    expect(hasFieldsMaskOrAllowlist(`await api.spreadsheets.get({ spreadsheetId });`)).toBe(false);
  });

  it('flags newly added unmasked calls', () => {
    const addedCalls = [{ filePath: 'src/example.ts', lineNumber: 1 }];
    const fileContent = `await api.spreadsheets.get({\n  spreadsheetId,\n});\n`;

    const violations = findFieldsMaskViolations(addedCalls, () => fileContent);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe('src/example.ts');
    expect(violations[0]?.lineNumber).toBe(1);
  });
});
