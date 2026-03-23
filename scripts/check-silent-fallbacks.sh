#!/bin/bash
# Check for silent fallbacks (return {} or return undefined without logging)
# Part of Claude Code Rules enforcement (Rule 5: No Silent Fallbacks)
#
# Legitimate patterns that are excluded:
# - Functions with typed `| undefined` return types (guard clauses)
# - Returns with inline comments explaining the reason
# - Zod .preprocess() callbacks (schema transforms)
# - Logger calls before the return
# - Explicit "// OK: Explicit empty" annotations

set -e

echo "🔍 Checking for silent fallbacks..."

# Create temporary files
TEMP_FILE=$(mktemp)
FILTERED_FILE=$(mktemp)

# Search for return {} or return undefined patterns
# Exclude test files
# Look back 5 lines to check for logger calls, typed signatures, or OK comments
rg -n "return \{\}|return undefined" src/ --type ts \
  --glob '!*.test.ts' \
  -B 5 2>/dev/null > "$TEMP_FILE" || true

# Filter out blocks that contain legitimate patterns
# Process in blocks separated by --
awk '
BEGIN { block = "" }
/^--$/ {
  if (block != "") check_block()
  block = ""
  next
}
{ block = block $0 "\n" }
END {
  if (block != "") check_block()
}

function check_block() {
  # Skip if block contains any of these legitimate patterns:
  # 1. Logger calls (explicit logging before return)
  if (block ~ /logger\./) return
  # 2. Explicit OK comments
  if (block ~ /\/\/ OK: Explicit empty/) return
  if (block ~ /\/\/ Acceptable empty return/) return
  # 3. JSDoc comment blocks
  if (block ~ / \* /) return
  # 4. Typed return signatures (| undefined in function sig or type annotation)
  if (block ~ /\| undefined/) return
  # 5. Zod preprocess callbacks
  if (block ~ /\.preprocess/) return
  # 6. Switch case default/fallthrough (returning undefined for unmatched cases)
  if (block ~ /case /) return
  if (block ~ /default:/) return
  # 7. Property extraction patterns (if/typeof guard returns)
  if (block ~ /typeof .* === /) return
  if (block ~ / in result/) return
  # 8. Loop search patterns (for...of returning undefined after loop)
  if (block ~ /for .*of /) return
  # 9. Return lines with inline comments (developer explained intent)
  # Check each return line — skip block if ALL returns have comments
  n = split(block, lines, "\n")
  uncommented = 0
  for (i = 1; i <= n; i++) {
    if (lines[i] ~ /return (\{\}|undefined)/) {
      if (lines[i] !~ /\/\//) {
        uncommented++
      }
    }
  }
  if (uncommented == 0) return

  # This block has an unexplained silent fallback
  print block
  print ""
}
' "$TEMP_FILE" > "$FILTERED_FILE"

if [ -s "$FILTERED_FILE" ]; then
  COUNT=$(grep -E -c "return (\\{\\}|undefined)" "$FILTERED_FILE" || true)
  echo ""
  echo "❌ Found $COUNT potential silent fallback(s):"
  echo ""
  cat "$FILTERED_FILE"
  echo ""
  echo "Fix options:"
  echo "  - Add logging before returning empty values"
  echo "  - Add inline comment: return undefined; // reason"
  echo "  - Add annotation: // OK: Explicit empty"
  echo "  - Add typed return: ): Type | undefined"
  echo ""
  echo "See: docs/development/CLAUDE_CODE_RULES.md (Rule 5)"
  rm "$TEMP_FILE" "$FILTERED_FILE"
  exit 1
else
  echo "✅ No silent fallbacks detected"
  rm "$TEMP_FILE" "$FILTERED_FILE"
  exit 0
fi
