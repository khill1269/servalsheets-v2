#!/bin/bash
# Documentation Link Checker
# Checks for broken internal links in markdown files

set -e

DOCS_DIR="docs"
ISSUES=0

echo "🔍 Documentation Link Checker"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Find all markdown files (excluding archive and generated)
FILES=$(find "$DOCS_DIR" -type f -name "*.md" \
  ! -path "*/archive/*" \
  ! -path "*/generated/*" \
  ! -path "*/.vitepress/*" \
  2>/dev/null)

# Also check root markdown files
ROOT_FILES=$(ls -1 *.md 2>/dev/null | grep -v CHANGELOG.md || true)

ALL_FILES="$FILES $ROOT_FILES"
FILE_COUNT=$(echo "$ALL_FILES" | wc -w)

echo "Found $FILE_COUNT markdown files to check"
echo ""

# Extract and check relative links
for file in $ALL_FILES; do
  [ -f "$file" ] || continue

  # Extract markdown links: [text](path)
  # Only check relative links (not http/https/mailto)
  links=$(grep -oE '\[[^\]]*\]\([^)]+\)' "$file" 2>/dev/null | \
    grep -oE '\([^)]+\)' | \
    tr -d '()' | \
    grep -v '^http' | \
    grep -v '^https' | \
    grep -v '^mailto' | \
    grep -v '^#' || true)

  for link in $links; do
    # Remove anchor from link
    link_path="${link%%#*}"
    [ -z "$link_path" ] && continue

    # Resolve relative path
    dir=$(dirname "$file")

    if [[ "$link_path" == /* ]]; then
      # Absolute path from docs root
      target="$DOCS_DIR$link_path"
    else
      # Relative path
      target="$dir/$link_path"
    fi

    # Normalize path
    target=$(realpath -m "$target" 2>/dev/null || echo "$target")

    # Check if file exists
    if [ ! -f "$target" ] && [ ! -f "${target}.md" ] && [ ! -f "$target/index.md" ] && [ ! -f "$target/README.md" ]; then
      echo "❌ Broken link in $file"
      echo "   → $link"
      echo "   Expected: $target"
      echo ""
      ISSUES=$((ISSUES + 1))
    fi
  done
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ISSUES -gt 0 ]; then
  echo "❌ Found $ISSUES broken links"
  exit 1
else
  echo "✅ All internal links valid!"
  exit 0
fi
