import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, 'src');
// Match default emoji presentation characters plus text symbols explicitly rendered as emoji
// with a variation selector, e.g. "⚠️". This avoids flagging plain arrows like "↔".
const EMOJI_RE = /(?:\p{Emoji_Presentation}|(?:\p{Extended_Pictographic}\uFE0F))/u;
const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.html']);
const IGNORED_PREFIXES = ['knowledge/', 'ui/'];

// These files intentionally contain user-facing emoji in prompts, docs, HTML, or UX copy.
// Any new emoji usage outside this allowlist should be treated as suspicious.
const EMOJI_ALLOWLIST = new Set([
  'admin/dashboard.html',
  'admin/dashboard.js',
  'analysis/comprehensive.ts',
  'cli.ts',
  'cli/auth-error.html',
  'cli/auth-setup.ts',
  'cli/auth-success.html',
  'cli/replay.ts',
  'cli/schema-manager.ts',
  'core/diff-engine.ts',
  'graphql/server.ts',
  'handlers/analyze-actions/formulas.ts',
  'mcp/elicitation.ts',
  'mcp/features-2025-11-25.ts',
  'mcp/registration/prompt-registration.ts',
  'oauth-provider.ts',
  'resources/confirm.ts',
  'schemas/descriptions-minimal.ts',
  'schemas/descriptions.ts',
  'schemas/dimensions.ts',
  'schemas/federation.ts',
  'schemas/format.ts',
  'schemas/session.ts',
  'server.ts',
  'services/confirmation-policy.ts',
  'services/confirm-service.ts',
  'services/metrics-dashboard.ts',
  'services/schema-validator.ts',
  'services/sheet-generator.ts',
  'utils/error-factory.ts',
  'utils/api-key-server.ts',
  'utils/oauth-callback-server.ts',
  'utils/range-helpers.ts',
  'utils/response-diff.ts',
  'utils/schema-compat.ts',
]);

function walkSource(dir: string): string[] {
  const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry);
    const relative = path.relative(SOURCE_ROOT, absolute);

    if (IGNORED_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
      continue;
    }

    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...walkSource(absolute));
      continue;
    }

    if (INCLUDED_EXTENSIONS.has(path.extname(entry))) {
      files.push(relative);
    }
  }

  return files;
}

function findEmojiLines(content: string): number[] {
  const lines = content.split('\n');
  const matches: number[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (EMOJI_RE.test(lines[index] ?? '')) {
      matches.push(index + 1);
    }
  }

  return matches;
}

describe('source emoji guard', () => {
  it('keeps runtime source emoji-free unless the file is explicitly allowlisted', () => {
    const violations: string[] = [];

    for (const relativePath of walkSource(SOURCE_ROOT)) {
      const absolutePath = path.join(SOURCE_ROOT, relativePath);
      const content = readFileSync(absolutePath, 'utf8');
      const emojiLines = findEmojiLines(content);

      if (emojiLines.length === 0) {
        continue;
      }

      if (!EMOJI_ALLOWLIST.has(relativePath)) {
        violations.push(`${relativePath}:${emojiLines.slice(0, 5).join(',')}`);
      }
    }

    expect(
      violations,
      [
        'Unexpected emoji found in runtime source.',
        'Remove the emoji or, if it is deliberate user-facing copy, add the file to the allowlist in tests/unit/source-emoji-guard.test.ts.',
        violations.length > 0 ? `Violations:\n${violations.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    ).toEqual([]);
  });
});
