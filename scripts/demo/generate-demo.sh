#!/bin/bash
# Automated Demo Generator for ServalSheets
# Creates asciinema recordings without interactive input

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/docs/public/demos"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ServalSheets Automated Demo Generator   ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"

# Create hero demo script
create_hero_demo() {
    cat > /tmp/hero_demo.sh << 'SCRIPT'
#!/bin/bash
# ServalSheets Hero Demo

# Clear screen with animation effect
clear

# Title
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║                     ServalSheets                          ║"
echo "  ║     Production-Grade Google Sheets MCP Server             ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""
sleep 1

# Show version
echo -e "\033[1;34m$\033[0m npx servalsheets --version"
sleep 0.5
echo "ServalSheets v1.6.0"
echo "MCP Protocol: 2025-11-25"
echo "Tools: 19 | Actions: 252"
echo ""
sleep 1

# Show tools list
echo -e "\033[1;34m$\033[0m npx servalsheets tools"
sleep 0.5
echo ""
echo "┌─────────────────────┬──────────┬─────────────────────────────────┐"
echo "│ Tool                │ Actions  │ Description                     │"
echo "├─────────────────────┼──────────┼─────────────────────────────────┤"
echo "│ sheets_data         │    15    │ Read, write, append, clear      │"
echo "│ sheets_structure    │    18    │ Sheets, rows, columns           │"
echo "│ sheets_formatting   │    22    │ Styles, borders, colors         │"
echo "│ sheets_analysis     │    16    │ Patterns, profiling             │"
echo "│ sheets_charts       │    12    │ Create and modify charts        │"
echo "│ ...                 │   169    │ And many more!                  │"
echo "└─────────────────────┴──────────┴─────────────────────────────────┘"
echo ""
sleep 2

# Read example
echo -e "\033[1;34m$\033[0m # Read spreadsheet data"
sleep 0.5
echo -e "\033[1;34m$\033[0m npx servalsheets read 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms 'Sales!A1:D5'"
sleep 0.5
echo ""
echo "┌──────────┬─────────┬───────┬────────────┐"
echo "│ Product  │ Q1      │ Q2    │ Q3         │"
echo "├──────────┼─────────┼───────┼────────────┤"
echo "│ Widget A │ \$12,500 │ \$15,800 │ \$18,200  │"
echo "│ Widget B │ \$8,900  │ \$9,500  │ \$11,200  │"
echo "│ Widget C │ \$6,200  │ \$7,100  │ \$8,400   │"
echo "│ Total    │ \$27,600 │ \$32,400 │ \$37,800  │"
echo "└──────────┴─────────┴───────┴────────────┘"
echo ""
echo "✓ Read 4 rows, 4 columns in 145ms"
echo ""
sleep 2

# Safety rails demo
echo -e "\033[1;34m$\033[0m # Safety rails: Preview with dry-run"
sleep 0.5
echo -e "\033[1;34m$\033[0m npx servalsheets write ... --dry-run"
sleep 0.5
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  DRY RUN MODE - No changes will be made                   ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Would update: Sheet1!A1:D10                              ║"
echo "║  Rows affected: 10                                        ║"
echo "║  Cells modified: 40                                       ║"
echo "║  API calls: 1                                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
sleep 2

# AI features
echo -e "\033[1;34m$\033[0m # AI-Powered Analysis"
sleep 0.5
echo -e "\033[1;34m$\033[0m npx servalsheets analyze ... --patterns"
sleep 0.5
echo ""
echo "🔍 Pattern Analysis Results:"
echo ""
echo "  📈 Trend: Upward (+12.3% month-over-month)"
echo "  🔄 Seasonality: Q4 peak detected"
echo "  ⚠️  Anomaly: Row 47 value 3.2σ from mean"
echo "  📊 Recommendation: Line chart with trendline"
echo ""
sleep 2

echo -e "\033[1;32m✓ ServalSheets - Ready for production!\033[0m"
echo ""
sleep 1
SCRIPT
    chmod +x /tmp/hero_demo.sh
}

# Record demo with asciinema
record_demo() {
    local name=$1
    local script=$2
    local cast_file="$OUTPUT_DIR/$name.cast"
    local gif_file="$OUTPUT_DIR/$name.gif"
    
    echo -e "${GREEN}Recording: $name${NC}"
    
    # Record using script
    /opt/homebrew/bin/asciinema rec "$cast_file" \
        --command "$script" \
        --title "ServalSheets - $name" \
        --cols 70 \
        --rows 24 \
        --idle-time-limit 0.5 \
        --overwrite
    
    echo -e "${GREEN}Converting to GIF...${NC}"
    
    # Convert to GIF
    /opt/homebrew/bin/agg "$cast_file" "$gif_file" \
        --theme monokai \
        --font-size 14 \
        --cols 70 \
        --rows 24
    
    # Optimize
    /opt/homebrew/bin/gifsicle -O3 --colors 256 "$gif_file" -o "${gif_file%.gif}-optimized.gif"
    
    # Get file sizes
    local original_size=$(stat -f%z "$gif_file" 2>/dev/null || stat -c%s "$gif_file")
    local optimized_size=$(stat -f%z "${gif_file%.gif}-optimized.gif" 2>/dev/null || stat -c%s "${gif_file%.gif}-optimized.gif")
    
    echo -e "${GREEN}✓ Created: ${gif_file%.gif}-optimized.gif${NC}"
    echo "  Original: $(numfmt --to=iec $original_size 2>/dev/null || echo "$original_size bytes")"
    echo "  Optimized: $(numfmt --to=iec $optimized_size 2>/dev/null || echo "$optimized_size bytes")"
    echo ""
}

# Main
echo ""
echo "Creating demo scripts..."
create_hero_demo

echo ""
echo "Recording hero demo..."
record_demo "hero" "/tmp/hero_demo.sh"

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Demo Complete!                         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Files created in: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*.gif 2>/dev/null || echo "No GIF files found"
