#!/bin/bash
# Check commit size (warn if >3 src/ files being committed)
# Part of Claude Code Rules enforcement (Rule 4: Minimal Change Policy)

set -e

echo "🔍 Checking commit size..."

# Count staged src/ files (both .ts and subdirectories)
STAGED_SRC_FILES=$(git diff --cached --name-only 2>/dev/null | grep "^src/.*\.ts$" | wc -l | tr -d ' ')

# If no staged files, nothing to check
if [ "$STAGED_SRC_FILES" -eq 0 ]; then
  echo "✅ No src/ files staged"
  exit 0
fi

# Check if more than 3 files
if [ "$STAGED_SRC_FILES" -gt 3 ]; then
  echo ""
  echo "⚠️  Warning: Committing $STAGED_SRC_FILES src/ files (>3)"
  echo ""
  echo "Claude Code Rules recommend ≤3 src/ files per commit for easier review."
  echo ""
  echo "Exceptions allowed for:"
  echo "  - Schema changes (triggers metadata regeneration)"
  echo "  - Test files (unlimited)"
  echo "  - Documentation files (unlimited)"
  echo ""
  echo "Files being committed:"
  git diff --cached --name-only | grep "^src/.*\.ts$"
  echo ""
  echo "See: docs/development/CLAUDE_CODE_RULES.md (Rule 4)"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Commit cancelled. Consider splitting into smaller commits."
    exit 1
  fi
  echo "✅ Proceeding with large commit (user override)"
else
  echo "✅ Commit size OK ($STAGED_SRC_FILES src/ files)"
fi

exit 0
