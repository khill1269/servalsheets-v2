#!/bin/bash
#
# Fix incorrect action counts in documentation
# Replaces 272 and 291 with the correct count (293)
#
# Usage: bash scripts/fix-doc-action-counts.sh [--dry-run]

set -e

DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo "🔍 DRY RUN MODE - No files will be modified"
  echo ""
fi

# Get the correct action count from source of truth
EXPECTED=$(node -e "import('./src/schemas/annotations.js').then(m => console.log(m.ACTION_COUNT))" 2>/dev/null || echo "293")

echo "🔧 Fixing action counts in documentation..."
echo "Target: $EXPECTED actions"
echo ""

OLD_COUNTS=("272" "291")
FIXED_COUNT=0

for OLD_COUNT in "${OLD_COUNTS[@]}"; do
  echo "Replacing '$OLD_COUNT actions' with '$EXPECTED actions'..."

  # Find all files with incorrect counts
  FILES=$(grep -rl "$OLD_COUNT actions" \
    --include="*.md" \
    --include="*.ts" \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=.git \
    --exclude-dir=bundle \
    --exclude-dir=.plan \
    . 2>/dev/null || true)

  if [ -z "$FILES" ]; then
    echo "  No files found with '$OLD_COUNT actions'"
    continue
  fi

  FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
  echo "  Found $FILE_COUNT file(s) to update"

  if [ "$DRY_RUN" = true ]; then
    echo "$FILES" | while read -r file; do
      echo "    Would fix: $file"
    done
  else
    echo "$FILES" | while read -r file; do
      # Use sed to replace in-place
      # macOS requires -i '' for in-place editing without backup
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/$OLD_COUNT actions/$EXPECTED actions/g" "$file"
      else
        sed -i "s/$OLD_COUNT actions/$EXPECTED actions/g" "$file"
      fi
      echo "    ✅ Fixed: $file"
      FIXED_COUNT=$((FIXED_COUNT + 1))
    done
  fi
  echo ""
done

# Also fix the comment in schemas/index.ts with outdated breakdown
echo "Updating schemas/index.ts comment with correct breakdown..."
SCHEMAS_FILE="src/schemas/index.ts"

if [ "$DRY_RUN" = true ]; then
  echo "  Would update: $SCHEMAS_FILE"
else
  # Replace the outdated comment with a reference to ACTION_COUNTS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' '/^\/\/ Last updated:/,/^\/\/   sheets_dependencies: 7$/c\
// Last updated: '"$(date +%Y-%m-%d)"'\
// See ACTION_COUNTS in annotations.ts for per-tool breakdown\
// Sum: 305 actions across 22 tools
' "$SCHEMAS_FILE"
  else
    sed -i '/^\/\/ Last updated:/,/^\/\/   sheets_dependencies: 7$/c\
// Last updated: '"$(date +%Y-%m-%d)"'\
// See ACTION_COUNTS in annotations.ts for per-tool breakdown\
// Sum: 305 actions across 22 tools
' "$SCHEMAS_FILE"
  fi
  echo "  ✅ Fixed: $SCHEMAS_FILE"
fi

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "🔍 Dry run complete. Run without --dry-run to apply changes."
else
  echo "✅ Fixed action counts in documentation"
  echo ""
  echo "Verifying changes..."
  if bash scripts/check-doc-action-counts.sh; then
    echo ""
    echo "✅ All action counts verified!"
  else
    echo ""
    echo "⚠️  Some files may still need manual review"
  fi
fi
