#!/usr/bin/env bash
# Generate archive index for historical documentation

set -euo pipefail

ARCHIVE_DIR="docs/archive"
OUTPUT_FILE="$ARCHIVE_DIR/INDEX.md"

echo "📚 Generating archive index..."

cat > "$OUTPUT_FILE" << 'EOF'
---
title: Documentation Archive Index
description: Historical and deprecated documentation files
category: archived
last_updated: TIMESTAMP
---

# Documentation Archive Index

> **Note:** These documents are archived and may be outdated. For current documentation, see [docs/](../).

## Overview

This archive contains historical documentation, deprecated guides, and old analysis reports that are no longer actively maintained but kept for reference.

**Total archived files:** FILE_COUNT

**Last updated:** TIMESTAMP

## Archive Structure

EOF

# Count files
TOTAL_FILES=$(find "$ARCHIVE_DIR" -name "*.md" -type f | wc -l | tr -d ' ')

# Add folder listings
find "$ARCHIVE_DIR" -type d -not -path "$ARCHIVE_DIR" | sort | while read -r dir; do
  rel_path="${dir#$ARCHIVE_DIR/}"
  file_count=$(find "$dir" -maxdepth 1 -name "*.md" -type f | wc -l | tr -d ' ')

  if [[ "$file_count" -gt 0 ]]; then
    echo "### $rel_path ($file_count files)" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"

    find "$dir" -maxdepth 1 -name "*.md" -type f | sort | while read -r file; do
      filename=$(basename "$file")
      rel_file_path="${file#docs/}"
      title=$(grep "^# " "$file" 2>/dev/null | head -1 | sed 's/^# //' || echo "$filename")
      echo "- [$title](/$rel_file_path)" >> "$OUTPUT_FILE"
    done

    echo "" >> "$OUTPUT_FILE"
  fi
done

# Add footer
cat >> "$OUTPUT_FILE" << 'EOF'

---

## Maintenance

Archived files are not included in the main documentation catalog and are excluded from link checking and linting.

**If you need to reference archived content:**
1. Check if there's a newer version in active docs
2. Consider updating the current docs rather than using archived versions
3. Contact the team if critical information seems missing

EOF

# Replace placeholders
TIMESTAMP=$(date -u +"%Y-%m-%d")
sed -i.bak "s/TIMESTAMP/$TIMESTAMP/g" "$OUTPUT_FILE"
sed -i.bak "s/FILE_COUNT/$TOTAL_FILES/g" "$OUTPUT_FILE"
rm "$OUTPUT_FILE.bak"

echo "✅ Archive index generated: $OUTPUT_FILE"
echo "   Total archived files: $TOTAL_FILES"
