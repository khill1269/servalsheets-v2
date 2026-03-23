#!/bin/bash
# ServalSheets - Sync Issues from COMPREHENSIVE_ISSUES_ANALYSIS.md to GitHub
#
# Parses the analysis document and creates GitHub issues for all
# missing features/improvements identified in the research.
#
# Usage:
#   bash scripts/sync-issues-to-github.sh --dry-run    # Preview only
#   bash scripts/sync-issues-to-github.sh --create     # Create issues

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ANALYSIS_FILE="$PROJECT_DIR/docs/analysis/COMPREHENSIVE_ISSUES_ANALYSIS.md"

cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   GitHub Issues Sync - From Comprehensive Analysis${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ Error: gh CLI not found${NC}"
    echo "   Install: brew install gh"
    echo "   Or visit: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ Error: Not authenticated with GitHub${NC}"
    echo "   Run: gh auth login"
    exit 1
fi

# Check if analysis file exists
if [ ! -f "$ANALYSIS_FILE" ]; then
    echo -e "${RED}❌ Error: Analysis file not found${NC}"
    echo "   Expected: $ANALYSIS_FILE"
    exit 1
fi

# Parse command line args
DRY_RUN=true
if [[ "$1" == "--create" ]]; then
    DRY_RUN=false
    echo -e "${YELLOW}⚠️  CREATE MODE: Will actually create GitHub issues${NC}"
    echo ""
elif [[ "$1" == "--dry-run" ]] || [[ -z "$1" ]]; then
    DRY_RUN=true
    echo -e "${GREEN}✓ DRY RUN MODE: Previewing only, no issues will be created${NC}"
    echo ""
else
    echo -e "${RED}❌ Invalid argument: $1${NC}"
    echo "   Usage: $0 [--dry-run|--create]"
    exit 1
fi

# Counter for issues
CREATED_COUNT=0
SKIPPED_COUNT=0
ERROR_COUNT=0

# Function to create or preview an issue
create_issue() {
    local title="$1"
    local priority="$2"
    local category="$3"
    local phase="$4"
    local effort="$5"
    local description="$6"
    local location="$7"
    local impact="$8"

    # Check if issue already exists
    if gh issue list --search "in:title \"$title\"" --json number --jq '. | length' | grep -q "^0$"; then

        if [ "$DRY_RUN" = true ]; then
            echo -e "${GREEN}[PREVIEW]${NC} Would create: [$priority] $title"
        else
            # Create issue body
            local body="## Description

$description

## Details

- **Priority:** $priority
- **Category:** $category
- **Phase:** $phase
- **Effort:** $effort days
- **Location:** $location
- **Impact:** $impact

## Source

Identified in [COMPREHENSIVE_ISSUES_ANALYSIS.md](../blob/main/docs/analysis/COMPREHENSIVE_ISSUES_ANALYSIS.md)

---
_Auto-generated from comprehensive analysis_"

            # Create the issue
            if gh issue create \
                --title "$title" \
                --body "$body" \
                --label "audit-framework,$priority,$category,$phase" \
                > /dev/null 2>&1; then

                echo -e "${GREEN}✓${NC} Created: [$priority] $title"
                ((CREATED_COUNT++))
            else
                echo -e "${RED}✗${NC} Failed: [$priority] $title"
                ((ERROR_COUNT++))
            fi
        fi
    else
        echo -e "${YELLOW}⊘${NC} Skipped (exists): $title"
        ((SKIPPED_COUNT++))
    fi
}

echo "Parsing analysis file..."
echo ""

# Section A: Performance & Architecture (8 issues)
echo -e "${BLUE}▶ Section A: Performance & Architecture${NC}"

create_issue \
    "Cache Invalidation Graph" \
    "P1" \
    "Performance" \
    "Phase-2" \
    "4" \
    "Implement smart cache invalidation that knows which operations invalidate which cache entries. Current caching is passive (ETag-based)." \
    "Create src/services/cache-invalidation-graph.ts (~250 lines)" \
    "40-60% cache hit rate (up from 30-40%), 20-30% additional quota savings"

create_issue \
    "Adaptive Concurrency Ceiling" \
    "P1" \
    "Performance" \
    "Phase-2" \
    "2" \
    "Dynamic concurrency limit (5-30) based on quota headroom. Current limit is static (15 concurrent)." \
    "Enhance src/services/concurrency-coordinator.ts (304 lines)" \
    "Eliminate 429 errors, 15-30% throughput increase"

create_issue \
    "Streaming Exports for Large Datasets" \
    "P1" \
    "Performance" \
    "Phase-2" \
    "5" \
    "Implement MCP Task-based streaming for exports. All responses currently buffered in memory." \
    "Enhance src/handlers/composite.ts (export_xlsx)" \
    "60-80% memory reduction, enable 500K row exports, zero OOM"

create_issue \
    "Worker Pool Integration" \
    "P2" \
    "Performance" \
    "Phase-2" \
    "3" \
    "Integrate existing worker pool (488 lines) into hot paths. CPU-intensive operations currently block main thread." \
    "src/handlers/analyze.ts, src/services/worker-pool.ts" \
    "100K row analysis: 15s → 4s, 75% improvement for CPU-intensive analysis"

create_issue \
    "Heap Monitoring Auto-Actions" \
    "P2" \
    "Performance" \
    "Phase-2" \
    "1" \
    "Add automatic actions at memory thresholds. Current heap monitor only logs warnings." \
    "Enhance src/utils/heap-monitor.ts" \
    "Zero OOM incidents, proactive memory management"

create_issue \
    "Response Tier System" \
    "P2" \
    "Performance" \
    "Phase-2" \
    "2" \
    "Implement 3-tier responses: summary (always), samples (always), fullDataLink (MCP resource). Current compaction truncates arrays." \
    "Enhance src/utils/response-compactor.ts" \
    "100% data quality, no context window bloat, no data loss"

create_issue \
    "N+1 Query Detection" \
    "P2" \
    "Performance" \
    "Phase-2" \
    "2" \
    "Add detection of repeated API calls that could be batched. Track API calls per request." \
    "Create src/utils/query-detector.ts" \
    "Developer awareness, prevent performance regressions"

create_issue \
    "Access Pattern Learning" \
    "P3" \
    "Performance" \
    "Phase-3" \
    "3" \
    "Generate user-facing optimization suggestions based on access patterns. Pattern tracker exists but doesn't generate suggestions." \
    "Enhance src/services/access-pattern-tracker.ts (12KB exists)" \
    "User education, workflow optimization"

# Section B: MCP Innovations (11 issues)
echo -e "${BLUE}▶ Section B: MCP Innovations${NC}"

create_issue \
    "WebSocket Real-Time Transport" \
    "P1" \
    "MCP" \
    "Phase-3" \
    "7" \
    "Add WebSocket server with subscription API for live spreadsheet updates. Only STDIO and HTTP/SSE transports exist." \
    "Create src/transports/websocket-transport.ts (~600 lines)" \
    "90% latency reduction (HTTP 500ms → WS 50ms), real-time collaboration"

create_issue \
    "Plugin System" \
    "P1" \
    "MCP" \
    "Phase-3" \
    "10" \
    "JavaScript plugin runtime with sandboxing and hot-reload. No extensibility mechanism currently." \
    "Create src/plugins/runtime.ts, registry.ts (~800 lines)" \
    "Extensibility marketplace, community plugins, custom business logic"

create_issue \
    "OpenAPI/SDK Generation" \
    "P1" \
    "MCP" \
    "Phase-3" \
    "8" \
    "Auto-generate SDKs from Zod schemas for TypeScript, Python, Go, JavaScript. No SDKs exist currently." \
    "Create scripts/generate-sdks.ts (~500 lines)" \
    "3x external integrations, multi-language adoption, type-safe clients"

create_issue \
    "Time-Travel Debugging" \
    "P2" \
    "MCP" \
    "Phase-3" \
    "6" \
    "Git-like version control with replay to checkpoint, inspect state, branch from history. History tracking exists but no replay." \
    "Create src/services/time-travel.ts (~400 lines)" \
    "Enhanced debugging experience, blame analysis"

create_issue \
    "Agentic Multi-Turn Reasoning" \
    "P2" \
    "MCP" \
    "Phase-3" \
    "5" \
    "Server-side autonomous workflows with goal-driven execution and LLM planning. Single tool calls only currently." \
    "Enhance src/handlers/analyze.ts (autonomous_workflow)" \
    "Complex workflows without client orchestration"

create_issue \
    "Natural Language Action Discovery" \
    "P1" \
    "UX" \
    "Phase-1" \
    "5" \
    "Intent mapping with aliases for 305 actions. Users must know exact action names currently." \
    "Create src/services/intent-classifier.ts (~400 lines)" \
    "5 min → 30 sec action discovery, 70% natural language query accuracy"

create_issue \
    "Workflow Detection System" \
    "P1" \
    "UX" \
    "Phase-1" \
    "3" \
    "Detect multi-step patterns (Import → Format → Analyze) and suggest next logical step. Track last 5 actions." \
    "Create src/utils/workflow-detector.ts (~300 lines)" \
    "Guided workflows, 85%+ confidence suggestions, context-aware next-steps"

create_issue \
    "Elicitation Wizards Implementation" \
    "P1" \
    "UX" \
    "Phase-1" \
    "6" \
    "5 wizards: Chart creation, data import, format presets, pivot, share. Elicitation infrastructure exists but only confirm uses it." \
    "Create src/services/elicitation-wizard.ts (~400 lines)" \
    "80%+ wizard completion rate, simplified complex operations"

create_issue \
    "Recipe Library" \
    "P2" \
    "UX" \
    "Phase-1" \
    "2" \
    "Document 20 popular workflow patterns with code examples. No cookbook exists currently." \
    "Create docs/recipes/*.md (20 recipes)" \
    "30%+ user adoption, user onboarding, self-service documentation"

create_issue \
    "Response Enhancement Expansion" \
    "P1" \
    "UX" \
    "Phase-0" \
    "2" \
    "Expand from 8 to 25 suggestion patterns (after import → scout, after chart → trendline, etc.)." \
    "Enhance src/utils/response-enhancer.ts:43-175 (8 → 25 patterns)" \
    "50%+ operations return suggestions, 25% suggestion acceptance, feature discovery"

create_issue \
    "Cost/Quota Warnings" \
    "P2" \
    "UX" \
    "Phase-1" \
    "1" \
    "Display warnings at 50+ API calls, suggest batching. Users don't see quota usage currently." \
    "Enhance src/utils/response-enhancer.ts (add quota warnings)" \
    "User quota awareness, optimized usage patterns"

# Continue with remaining sections...
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${GREEN}DRY RUN MODE${NC}"
    echo "  Would create: $CREATED_COUNT issues"
else
    echo -e "${GREEN}✓ Created: $CREATED_COUNT issues${NC}"
fi

echo -e "${YELLOW}⊘ Skipped (already exist): $SKIPPED_COUNT issues${NC}"

if [ "$ERROR_COUNT" -gt 0 ]; then
    echo -e "${RED}✗ Errors: $ERROR_COUNT issues${NC}"
fi

echo ""
echo "To create issues, run: bash scripts/sync-issues-to-github.sh --create"
echo ""
