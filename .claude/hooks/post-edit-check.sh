#!/bin/bash
# Post-edit hook: Detects schema changes and auto-regenerates metadata
# Triggered after Write/Edit tool use
# Input: JSON via stdin with file_path field

# Read the tool use context from stdin (JSON with file_path)
INPUT=$(cat)

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('file_path','') or d.get('path',''))" 2>/dev/null)

# Fallback to grep-based extraction if python3 fails
if [ -z "$FILE_PATH" ]; then
  FILE_PATH=$(echo "$INPUT" | grep -oP '"file_path"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"file_path"\s*:\s*"//;s/"$//')
fi
if [ -z "$FILE_PATH" ]; then
  FILE_PATH=$(echo "$INPUT" | grep -oP '"path"\s*:\s*"([^"]*)"' | head -1 | sed 's/.*"path"\s*:\s*"//;s/"$//')
fi

# Check if the edited file is a schema file
if echo "$FILE_PATH" | grep -qE "src/schemas/.*\.ts$"; then
  echo "📐 Schema file modified: $(basename "$FILE_PATH")"
  echo "→ Auto-regenerating metadata..."
  cd '/Users/thomascahill/Documents/servalsheets 2' && node --import tsx scripts/generate-metadata.ts 2>&1 | tail -8
  echo "✅ Metadata regenerated. Run 'npm run test:fast' to verify, then commit."
fi

# Check if handler was edited without corresponding test
if echo "$FILE_PATH" | grep -qE "src/handlers/.*\.ts$"; then
  HANDLER_NAME=$(basename "$FILE_PATH" .ts)
  TEST_FILE="tests/handlers/${HANDLER_NAME}.test.ts"
  if [ ! -f "/Users/thomascahill/Documents/servalsheets 2/$TEST_FILE" ]; then
    echo "⚠️  Handler modified but no matching test file: $TEST_FILE"
  fi
fi

# Always succeed — generation is advisory, not blocking
exit 0
