#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Not inside a git worktree"
  exit 1
fi

PORCELAIN="$(git status --porcelain=v1 -uall)"

if [ -z "$PORCELAIN" ]; then
  echo "✅ Worktree is clean"
  exit 0
fi

echo "📊 Worktree Hygiene Report"
echo ""

echo "$PORCELAIN" | awk '
{
  x=substr($0,1,1); y=substr($0,2,1);
  if (x=="?" && y=="?") untracked++;
  else if (x!=" " && y!=" ") both++;
  else if (x!=" ") staged++;
  else if (y!=" ") unstaged++;
}
END {
  printf("  staged_only:   %d\n", staged+0);
  printf("  unstaged_only: %d\n", unstaged+0);
  printf("  both:          %d\n", both+0);
  printf("  untracked:     %d\n", untracked+0);
}'

echo ""
echo "📁 Changed top-level paths"
echo "$PORCELAIN" | awk '
{
  path=substr($0,4);
  split(path,a,"/");
  top=a[1];
  if (top=="") top="(root)";
  count[top]++;
}
END {
  for (k in count) printf("%5d  %s\n", count[k], k);
}' | sort -nr

echo ""
echo "⚠️  Paths with both staged + unstaged changes (MM)"
MM_LIST="$(echo "$PORCELAIN" | awk 'substr($0,1,1)!=" " && substr($0,1,1)!="?" && substr($0,2,1)!=" "{print substr($0,4)}')"
if [ -n "$MM_LIST" ]; then
  echo "$MM_LIST"
else
  echo "  (none)"
fi

echo ""
echo "🧹 Likely generated/unwanted untracked files"
UNTRACKED="$(echo "$PORCELAIN" | awk '$1=="??"{print $2}')"
if [ -z "$UNTRACKED" ]; then
  echo "  (none)"
else
  echo "$UNTRACKED" | rg -n '^(docs/development/complete-file-audit/|coverage/|dist/|audit-output/|\.performance-history/)' \
    --replace '$0' || echo "  (none matched generated patterns)"
fi
