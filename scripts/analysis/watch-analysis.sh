#!/bin/bash
# Watch mode for multi-agent analysis
# Monitors file changes and re-runs analysis

set -e

TARGET_DIR=${1:-"src"}

echo "👁️  Watching for changes in $TARGET_DIR..."
echo "Press Ctrl+C to stop"
echo ""

# Use fswatch if available, otherwise fall back to inotifywait or polling
if command -v fswatch &> /dev/null; then
  # macOS - use fswatch
  fswatch -o "$TARGET_DIR" | while read -r num; do
    echo "🔍 Change detected - running analysis..."
    find "$TARGET_DIR" -name '*.ts' -type f -mmin -1 | \
      xargs -I {} npx tsx scripts/analysis/multi-agent-analysis.ts {}
    echo "✅ Analysis complete"
    echo ""
  done
elif command -v inotifywait &> /dev/null; then
  # Linux - use inotifywait
  while inotifywait -r -e modify,create "$TARGET_DIR"; do
    echo "🔍 Change detected - running analysis..."
    find "$TARGET_DIR" -name '*.ts' -type f -mmin -1 | \
      xargs -I {} npx tsx scripts/analysis/multi-agent-analysis.ts {}
    echo "✅ Analysis complete"
    echo ""
  done
else
  # Fallback - polling every 3 seconds
  echo "⚠️  No file watcher found (fswatch/inotifywait) - using polling mode"

  LAST_CHECK=$(date +%s)

  while true; do
    sleep 3

    CURRENT_TIME=$(date +%s)

    # Find files modified in last 3 seconds
    CHANGED_FILES=$(find "$TARGET_DIR" -name '*.ts' -type f -newermt "@$LAST_CHECK" 2>/dev/null || echo "")

    if [ -n "$CHANGED_FILES" ]; then
      echo "🔍 Change detected - running analysis..."
      echo "$CHANGED_FILES" | xargs -I {} npx tsx scripts/analysis/multi-agent-analysis.ts {}
      echo "✅ Analysis complete"
      echo ""
    fi

    LAST_CHECK=$CURRENT_TIME
  done
fi
