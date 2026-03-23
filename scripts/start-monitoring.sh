#!/bin/bash
# Start all monitoring systems for ServalSheets testing

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            🦁 ServalSheets Monitoring Startup                              ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if log file exists
LOG_FILE="$HOME/Library/Logs/Claude/mcp-server-ServalSheets.log"
if [ ! -f "$LOG_FILE" ]; then
  echo -e "${YELLOW}⚠️  Log file not found: $LOG_FILE${NC}"
  echo -e "${YELLOW}   Make sure Claude Desktop is running with ServalSheets configured.${NC}"
  echo ""
  echo -e "   ${GREEN}Expected config location:${NC} $HOME/Library/Application Support/Claude/claude_desktop_config.json"
  echo ""
  read -p "Press Enter to start monitoring anyway (will wait for logs)..."
fi

echo -e "${GREEN}✅ Starting live monitor...${NC}"
echo ""
echo -e "${CYAN}Monitoring features:${NC}"
echo "  📊 Real-time tool call tracking"
echo "  🔍 Error pattern detection"
echo "  ⚡ Performance metrics (slow call threshold: 2000ms)"
echo "  🚨 Anomaly detection (error spikes)"
echo "  ⏸️  Silence detection (idle >60s)"
echo "  📈 Validation error hot spots"
echo ""
echo -e "${CYAN}Health monitoring (automatic):${NC}"
echo "  💾 Heap health (warns at 70%, critical at 85%)"
echo "  🔗 Connection health (warns at 60s, critical at 120s)"
echo "  ⏰ Checks every 30 seconds"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop and show full analysis report${NC}"
echo ""
echo -e "${CYAN}─────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# Start live monitor with optimal settings for testing
# - Verbose mode to see full payloads
# - Slow threshold at 2000ms (2 seconds)
# - Export mode to save report
npx tsx scripts/live-monitor.ts --verbose --slow 2000 --export
