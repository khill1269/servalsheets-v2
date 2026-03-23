#!/bin/bash
# Validates bash commands before execution
# - Blocks truly destructive commands (exit 2)
# - Blocks git commit if metadata drift is detected (exit 2)
# Input: JSON via stdin with {"command": "..."} field

# Read tool input from stdin
INPUT=$(cat)

# Extract the command from JSON input
COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('command',''))" 2>/dev/null)

# Fallback: grep-based extraction
if [ -z "$COMMAND" ]; then
  COMMAND=$(echo "$INPUT" | grep -oP '"command"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"command"\s*:\s*"//;s/"$//')
fi

# Block truly destructive commands (exit 2 = blocked by Claude Code)
if echo "$COMMAND" | grep -qE "(rm -rf /|git reset --hard|git clean -fd|git push --force|git push -f|DROP TABLE|DROP DATABASE)"; then
  echo "❌ Destructive command blocked: $COMMAND" >&2
  echo "This command requires explicit user approval." >&2
  exit 2
fi

# Pre-commit gate: block 'git commit' if metadata drift detected
if echo "$COMMAND" | grep -qE "git commit"; then
  cd '/Users/thomascahill/Documents/servalsheets 2' 2>/dev/null || true
  DRIFT_OUTPUT=$(node --import tsx scripts/generate-metadata.ts --validate 2>&1)
  DRIFT_EXIT=$?
  if [ $DRIFT_EXIT -ne 0 ]; then
    echo "❌ git commit blocked: metadata drift detected" >&2
    echo "$DRIFT_OUTPUT" | grep -E "(❌|⚠️|ERROR|mismatch|drift)" | head -5 >&2
    echo "" >&2
    echo "Fix: run 'npm run schema:commit' first, then commit." >&2
    exit 2
  fi
fi

# Warn on risky commands but allow (exit 0)
if echo "$COMMAND" | grep -qE "rm -rf"; then
  echo "⚠️  Warning: Potentially risky command detected. Proceeding with caution." >&2
fi

# Allow all other commands
exit 0
