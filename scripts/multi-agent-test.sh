#!/bin/bash
# ServalSheets Multi-Agent Test Orchestrator v2.0
# Enhanced with retry logic, timing stats, and JSON summaries
# Runs parallel test workers for different tool categories

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_DIR/test-results"
LOG_DIR="$RESULTS_DIR/logs"
SUMMARY_FILE="$RESULTS_DIR/summary.json"

# Create directories
mkdir -p "$RESULTS_DIR" "$LOG_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Global counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
RETRIED_TESTS=0
START_TIME=$(date +%s)

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   ServalSheets Multi-Agent Test Orchestrator${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Tool categories for parallel execution
CATEGORY_CORE="sheets_core sheets_data sheets_format"
CATEGORY_ADVANCED="sheets_advanced sheets_dimensions sheets_visualize"
CATEGORY_COLLAB="sheets_collaborate sheets_templates sheets_session"
CATEGORY_UTILS="sheets_analyze sheets_quality sheets_history sheets_transaction"

# Function to run tests for a category with retry logic
run_category() {
    local category_name=$1
    shift
    local tools=("$@")
    local log_file="$LOG_DIR/${category_name}-$(date +%s).log"
    local category_start=$(date +%s)
    local passed=0
    local failed=0
    local retried=0

    echo -e "${YELLOW}[$(date +%T)] [Agent: $category_name]${NC} Starting tests for: ${tools[*]}"
    echo "[$(date +%T)] Starting $category_name tests" >> "$log_file"

    for tool in "${tools[@]}"; do
        local tool_start=$(date +%s)
        echo -e "${BLUE}[$(date +%T)] [Agent: $category_name]${NC} Running $tool... ($(($passed + $failed + 1))/${#tools[@]})"

        # Convert tool name (sheets_core → core)
        local handler_name="${tool#sheets_}"
        local test_file="tests/handlers/${handler_name}.test.ts"

        # Run vitest for this handler if test file exists
        if [ -f "$PROJECT_DIR/$test_file" ]; then
            local max_retries=2
            local attempt=1
            local test_passed=false

            while [ $attempt -le $max_retries ]; do
                echo "[$(date +%T)] Testing $tool (attempt $attempt/$max_retries)..." >> "$log_file"

                npx vitest run --reporter=json --outputFile="$RESULTS_DIR/${tool}-results.json" \
                    "$test_file" >> "$log_file" 2>&1
                local exit_code=$?

                if [ $exit_code -eq 0 ]; then
                    local duration=$(($(date +%s) - $tool_start))
                    echo -e "${GREEN}[$(date +%T)] [Agent: $category_name]${NC} ✓ $tool passed (${duration}s)"
                    echo "  ✓ $tool tests passed (${duration}s)" >> "$log_file"
                    test_passed=true
                    ((passed++))

                    if [ $attempt -gt 1 ]; then
                        ((retried++))
                        echo "    (succeeded after retry)" >> "$log_file"
                    fi
                    break
                else
                    if [ $attempt -lt $max_retries ]; then
                        echo -e "${YELLOW}[$(date +%T)] [Agent: $category_name]${NC} ✗ $tool failed, retrying ($attempt/$max_retries)..."
                        echo "  ✗ $tool tests failed (exit code: $exit_code), retrying..." >> "$log_file"
                        ((attempt++))
                        sleep 1
                    else
                        local duration=$(($(date +%s) - $tool_start))
                        echo -e "${RED}[$(date +%T)] [Agent: $category_name]${NC} ✗ $tool failed after $max_retries attempts (${duration}s)"
                        echo "  ✗ $tool tests failed after $max_retries attempts (exit code: $exit_code)" >> "$log_file"
                        ((failed++))
                        break
                    fi
                fi
            done
        else
            echo -e "${YELLOW}[$(date +%T)] [Agent: $category_name]${NC} ⚠ $tool test file not found"
            echo "  ⚠ $tool test file not found: $test_file" >> "$log_file"
        fi
    done

    local category_duration=$(($(date +%s) - $category_start))
    echo -e "${GREEN}[$(date +%T)] [Agent: $category_name]${NC} Completed in ${category_duration}s (Passed: $passed, Failed: $failed, Retried: $retried)"
    echo "[$(date +%T)] Category completed: Passed=$passed, Failed=$failed, Retried=$retried, Duration=${category_duration}s" >> "$log_file"

    # Update global counters (thread-safe with file locks)
    (
        flock -x 200
        TOTAL_TESTS=$(($TOTAL_TESTS + $passed + $failed))
        PASSED_TESTS=$(($PASSED_TESTS + $passed))
        FAILED_TESTS=$(($FAILED_TESTS + $failed))
        RETRIED_TESTS=$(($RETRIED_TESTS + $retried))
        echo "$TOTAL_TESTS $PASSED_TESTS $FAILED_TESTS $RETRIED_TESTS" > "$RESULTS_DIR/.counters"
    ) 200>"$RESULTS_DIR/.lock"
}

# Check if running in parallel mode
if [[ "$1" == "--parallel" ]]; then
    echo -e "${YELLOW}Running in PARALLEL mode (4 agents)${NC}"
    echo ""
    
    # Launch agents in background
    run_category "core" $CATEGORY_CORE &
    PID_CORE=$!
    
    run_category "advanced" $CATEGORY_ADVANCED &
    PID_ADVANCED=$!
    
    run_category "collab" $CATEGORY_COLLAB &
    PID_COLLAB=$!
    
    run_category "utils" $CATEGORY_UTILS &
    PID_UTILS=$!
    
    # Wait for all agents
    echo -e "${BLUE}Waiting for all agents to complete...${NC}"
    wait $PID_CORE $PID_ADVANCED $PID_COLLAB $PID_UTILS
    
    echo ""
    echo -e "${GREEN}All agents completed!${NC}"
else
    echo -e "${YELLOW}Running in SEQUENTIAL mode${NC}"
    echo "Use --parallel for multi-agent execution"
    echo ""
    
    run_category "core" $CATEGORY_CORE
    run_category "advanced" $CATEGORY_ADVANCED
    run_category "collab" $CATEGORY_COLLAB
    run_category "utils" $CATEGORY_UTILS
fi

# Load final counters
if [ -f "$RESULTS_DIR/.counters" ]; then
    read TOTAL_TESTS PASSED_TESTS FAILED_TESTS RETRIED_TESTS < "$RESULTS_DIR/.counters"
fi

# Calculate total duration
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_DURATION / 60))
SECONDS=$((TOTAL_DURATION % 60))

# Generate JSON summary
cat > "$SUMMARY_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "duration_seconds": $TOTAL_DURATION,
  "agents": 4,
  "mode": "${1:-sequential}",
  "tests": {
    "total": $TOTAL_TESTS,
    "passed": $PASSED_TESTS,
    "failed": $FAILED_TESTS,
    "retried": $RETRIED_TESTS
  },
  "pass_rate": $(echo "scale=2; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc),
  "results_dir": "$RESULTS_DIR",
  "logs_dir": "$LOG_DIR"
}
EOF

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Multi-Agent Test Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "Total Time:    ${MINUTES}m ${SECONDS}s"
echo -e "Agents:        4 (${1:-sequential} mode)"
echo -e "Tests Total:   $TOTAL_TESTS"
echo -e "${GREEN}Tests Passed:  $PASSED_TESTS${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}Tests Failed:  $FAILED_TESTS${NC}"
else
    echo -e "Tests Failed:  $FAILED_TESTS"
fi
if [ $RETRIED_TESTS -gt 0 ]; then
    echo -e "${YELLOW}Tests Retried: $RETRIED_TESTS${NC}"
fi
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Results directory: $RESULTS_DIR"
echo "Summary: $SUMMARY_FILE"
echo "Logs: $LOG_DIR"
echo ""

# Exit with appropriate code
if [ $FAILED_TESTS -gt 0 ]; then
    exit 1
else
    exit 0
fi
