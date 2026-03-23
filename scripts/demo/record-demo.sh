#!/bin/bash
# Demo Recording Script for ServalSheets
# Usage: ./record-demo.sh [demo-name]

set -e

DEMO_NAME=${1:-"basic"}
OUTPUT_DIR="assets/demos"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      ServalSheets Demo Recorder           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"

# Check dependencies
check_deps() {
    local missing=()
    command -v asciinema >/dev/null 2>&1 || missing+=("asciinema")
    command -v agg >/dev/null 2>&1 || missing+=("agg")
    command -v gifsicle >/dev/null 2>&1 || missing+=("gifsicle")
    
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${YELLOW}Missing dependencies: ${missing[*]}${NC}"
        echo "Install with: brew install ${missing[*]}"
        exit 1
    fi
}

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Demo scenarios
run_demo_basic() {
    cat << 'EOF'
# ServalSheets Basic Demo
# Reading and writing spreadsheet data

# First, let's read some data
npx servalsheets read "$SPREADSHEET_ID" "Sheet1!A1:D5"

# Now let's write new data
npx servalsheets write "$SPREADSHEET_ID" "Sheet1!A1" \
  '[["Product","Price","Stock"],["Widget",29.99,100],["Gadget",49.99,50]]'

# Verify the write
npx servalsheets read "$SPREADSHEET_ID" "Sheet1!A1:C3"
EOF
}

run_demo_safety() {
    cat << 'EOF'
# ServalSheets Safety Rails Demo
# Preventing accidental data loss

# Dry-run mode - see what WOULD happen without making changes
npx servalsheets write "$SPREADSHEET_ID" "A1:Z100" "[[...]]" --dry-run

# User confirmation for destructive operations
npx servalsheets clear "$SPREADSHEET_ID" "Sheet1!A:Z" --confirm

# Effect scope limits - prevent large operations
npx servalsheets delete-rows "$SPREADSHEET_ID" 0 --start 1 --count 1000 \
  --max-rows 100
EOF
}

run_demo_ai() {
    cat << 'EOF'
# ServalSheets AI Features Demo
# Intelligent spreadsheet analysis

# Analyze patterns in data
npx servalsheets analyze "$SPREADSHEET_ID" "Sales!A:F" --patterns

# Get formula suggestions
npx servalsheets analyze "$SPREADSHEET_ID" "Data!A1:D100" --formulas

# Chart recommendations
npx servalsheets analyze "$SPREADSHEET_ID" "Metrics!A:E" --charts
EOF
}

# Main recording function
record() {
    local demo=$1
    local cast_file="$OUTPUT_DIR/$demo.cast"
    local gif_file="$OUTPUT_DIR/$demo.gif"
    local optimized_file="$OUTPUT_DIR/$demo-optimized.gif"
    
    echo -e "${GREEN}Recording demo: $demo${NC}"
    echo -e "${YELLOW}Press Ctrl+D when finished${NC}"
    echo ""
    
    # Show script first
    case $demo in
        basic) run_demo_basic ;;
        safety) run_demo_safety ;;
        ai) run_demo_ai ;;
        *) echo "Unknown demo: $demo"; exit 1 ;;
    esac
    
    echo ""
    echo -e "${BLUE}Starting recording in 3 seconds...${NC}"
    sleep 3
    
    # Record
    asciinema rec "$cast_file" \
        --title "ServalSheets - $demo" \
        --idle-time-limit 2 \
        --cols 100 \
        --rows 25
    
    # Convert to GIF
    echo -e "${GREEN}Converting to GIF...${NC}"
    agg "$cast_file" "$gif_file" \
        --theme monokai \
        --font-size 14 \
        --speed 1.5 \
        --cols 100 \
        --rows 25
    
    # Optimize
    echo -e "${GREEN}Optimizing GIF...${NC}"
    gifsicle -O3 --colors 256 "$gif_file" -o "$optimized_file"
    
    # Stats
    local original_size=$(stat -f%z "$gif_file" 2>/dev/null || stat -c%s "$gif_file")
    local optimized_size=$(stat -f%z "$optimized_file" 2>/dev/null || stat -c%s "$optimized_file")
    local reduction=$(( (original_size - optimized_size) * 100 / original_size ))
    
    echo ""
    echo -e "${GREEN}Demo recorded successfully!${NC}"
    echo -e "  Cast file: $cast_file"
    echo -e "  GIF file:  $optimized_file"
    echo -e "  Size:      $(numfmt --to=iec $optimized_size) (${reduction}% reduction)"
}

# List available demos
list_demos() {
    echo "Available demos:"
    echo "  basic  - Basic read/write operations"
    echo "  safety - Safety rails demonstration"
    echo "  ai     - AI-powered features"
    echo ""
    echo "Usage: $0 <demo-name>"
}

# Main
check_deps

case $DEMO_NAME in
    list|--list|-l) list_demos ;;
    basic|safety|ai) record "$DEMO_NAME" ;;
    *)
        echo "Unknown demo: $DEMO_NAME"
        list_demos
        exit 1
        ;;
esac
