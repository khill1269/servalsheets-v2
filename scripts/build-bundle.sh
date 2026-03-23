#!/bin/bash
# Build ServalSheets .mcpb bundle for Claude Desktop

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$PROJECT_ROOT/bundle"
SERVER_DIR="$BUNDLE_DIR/server"
OUTPUT_FILE="$PROJECT_ROOT/servalsheets.mcpb"

echo "Building ServalSheets .mcpb bundle..."

# Step 1: Build the project
echo "Step 1/5: Building project..."
cd "$PROJECT_ROOT"
npm run build

# Step 2: Clean and prepare bundle directory
echo "Step 2/5: Preparing bundle directory..."
rm -rf "$SERVER_DIR"
mkdir -p "$SERVER_DIR"

# Step 3: Stage runtime package from current repo artifacts
echo "Step 3/5: Staging runtime package..."
node "$PROJECT_ROOT/scripts/stage-runtime-package.mjs" "bundle/server" --bundle-root "bundle"

# Install production dependencies in the server directory
# Step 4: Install production dependencies
echo "Step 4/5: Installing production dependencies..."
cd "$SERVER_DIR"
npm install --omit=dev --ignore-scripts --no-audit --no-fund 2>/dev/null

# Step 5: Create the .mcpb archive
echo "Step 5/5: Creating .mcpb bundle..."
cd "$BUNDLE_DIR"

# Remove old bundle if exists
rm -f "$OUTPUT_FILE"

# Create the zip (mcpb is a zip file)
zip -r "$OUTPUT_FILE" manifest.json server/ icon.png 2>/dev/null || \
zip -r "$OUTPUT_FILE" manifest.json server/

# Calculate size
BUNDLE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

echo ""
echo "=========================================="
echo " ServalSheets Bundle Created Successfully"
echo "=========================================="
echo ""
echo "  Output: $OUTPUT_FILE"
echo "  Size:   $BUNDLE_SIZE"
echo ""
echo "To install in Claude Desktop:"
echo "  1. Open Claude Desktop"
echo "  2. Go to Settings > Extensions"
echo "  3. Click 'Install from file'"
echo "  4. Select: servalsheets.mcpb"
echo ""
echo "Or double-click the .mcpb file to install."
echo ""
