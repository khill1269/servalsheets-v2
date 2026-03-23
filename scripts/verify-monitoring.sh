#!/bin/bash
# ServalSheets Monitoring Verification Script
# Validates that all observability components are working correctly

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
WARNINGS=0

# Function to print colored status
print_status() {
    local status=$1
    local message=$2
    case $status in
        "pass")
            echo -e "${GREEN}✓${NC} $message"
            PASSED_TESTS=$((PASSED_TESTS + 1))
            ;;
        "fail")
            echo -e "${RED}✗${NC} $message"
            FAILED_TESTS=$((FAILED_TESTS + 1))
            ;;
        "warn")
            echo -e "${YELLOW}⚠${NC} $message"
            WARNINGS=$((WARNINGS + 1))
            ;;
        "info")
            echo -e "${BLUE}ℹ${NC} $message"
            ;;
    esac
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

# Function to test HTTP endpoint
test_endpoint() {
    local name=$1
    local url=$2
    local expected_status=${3:-200}

    if curl -f -s -o /dev/null -w "%{http_code}" "$url" | grep -q "$expected_status"; then
        print_status "pass" "$name is responding (HTTP $expected_status)"
        return 0
    else
        print_status "fail" "$name is not responding"
        return 1
    fi
}

# Function to test JSON endpoint
test_json_endpoint() {
    local name=$1
    local url=$2
    local jq_filter=$3
    local expected_value=$4

    local result=$(curl -f -s "$url" | jq -r "$jq_filter" 2>/dev/null)

    if [ "$result" = "$expected_value" ]; then
        print_status "pass" "$name: $jq_filter = $expected_value"
        return 0
    else
        print_status "fail" "$name: expected $expected_value, got $result"
        return 1
    fi
}

# Function to check metric exists
check_metric() {
    local name=$1
    local metric=$2
    local endpoint=${3:-http://localhost:3000/metrics}

    if curl -f -s "$endpoint" | grep -q "^$metric"; then
        print_status "pass" "Metric exists: $metric"
        return 0
    else
        print_status "fail" "Metric missing: $metric"
        return 1
    fi
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}ServalSheets Monitoring Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ============================================
# Test 1: Prometheus
# ============================================
echo -e "${BLUE}Testing Prometheus...${NC}"

test_endpoint "Prometheus" "http://localhost:9090/-/healthy"
test_endpoint "Prometheus targets" "http://localhost:9090/api/v1/targets"
test_json_endpoint "Prometheus" "http://localhost:9090/api/v1/status/config" ".status" "success"

echo ""

# ============================================
# Test 2: Alertmanager
# ============================================
echo -e "${BLUE}Testing Alertmanager...${NC}"

test_endpoint "Alertmanager" "http://localhost:9093/-/healthy"
test_endpoint "Alertmanager status" "http://localhost:9093/api/v2/status"

echo ""

# ============================================
# Test 3: Grafana
# ============================================
echo -e "${BLUE}Testing Grafana...${NC}"

test_endpoint "Grafana" "http://localhost:3001/api/health"
test_json_endpoint "Grafana" "http://localhost:3001/api/health" ".database" "ok"

# Check if datasources are configured
if curl -f -s "http://admin:admin@localhost:3001/api/datasources" | jq -e '.[].type == "prometheus"' > /dev/null 2>&1; then
    print_status "pass" "Grafana has Prometheus datasource configured"
else
    print_status "warn" "Grafana may not have Prometheus datasource"
fi

echo ""

# ============================================
# Test 4: Loki
# ============================================
echo -e "${BLUE}Testing Loki...${NC}"

test_endpoint "Loki" "http://localhost:3100/ready"
test_endpoint "Loki metrics" "http://localhost:3100/metrics"

echo ""

# ============================================
# Test 5: Tempo
# ============================================
echo -e "${BLUE}Testing Tempo...${NC}"

test_endpoint "Tempo" "http://localhost:3200/ready"
test_endpoint "Tempo OTLP gRPC" "http://localhost:4317" "000"  # gRPC returns different code

echo ""

# ============================================
# Test 6: ServalSheets Metrics Endpoint
# ============================================
echo -e "${BLUE}Testing ServalSheets Metrics...${NC}"

if curl -f -s http://localhost:3000/metrics > /dev/null 2>&1; then
    print_status "pass" "ServalSheets metrics endpoint is accessible"

    # Check for key metrics
    check_metric "ServalSheets" "servalsheets_tool_calls_total"
    check_metric "ServalSheets" "servalsheets_google_api_calls_total"
    check_metric "ServalSheets" "servalsheets_cache_hits_total"
    check_metric "ServalSheets" "servalsheets_circuit_breaker_state"
    check_metric "ServalSheets" "servalsheets_tool_call_duration_seconds"

    # Check Node.js metrics
    check_metric "ServalSheets" "process_resident_memory_bytes"
    check_metric "ServalSheets" "nodejs_heap_size_total_bytes"
else
    print_status "fail" "ServalSheets metrics endpoint is not accessible"
    print_status "info" "Make sure ServalSheets is running on port 3000"
fi

echo ""

# ============================================
# Test 7: ServalSheets Health Endpoints
# ============================================
echo -e "${BLUE}Testing ServalSheets Health...${NC}"

if test_endpoint "Liveness probe" "http://localhost:3000/health/live"; then
    test_json_endpoint "Liveness" "http://localhost:3000/health/live" ".status" "healthy"
fi

if test_endpoint "Readiness probe" "http://localhost:3000/health/ready"; then
    test_json_endpoint "Readiness" "http://localhost:3000/health/ready" ".status" "healthy"
fi

echo ""

# ============================================
# Test 8: OpenTelemetry Configuration
# ============================================
echo -e "${BLUE}Testing OpenTelemetry...${NC}"

if [ "$OTEL_ENABLED" = "true" ]; then
    print_status "pass" "OTEL_ENABLED is set to true"

    if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
        print_status "pass" "OTEL_EXPORTER_OTLP_ENDPOINT is configured: $OTEL_EXPORTER_OTLP_ENDPOINT"
    else
        print_status "warn" "OTEL_EXPORTER_OTLP_ENDPOINT not set (using default: http://localhost:4318)"
    fi
else
    print_status "warn" "OTEL_ENABLED is not set to true"
    print_status "info" "Set OTEL_ENABLED=true to enable OpenTelemetry tracing"
fi

# Check if Tempo is receiving traces
if curl -f -s "http://localhost:3200/api/search" > /dev/null 2>&1; then
    print_status "pass" "Tempo trace API is accessible"
else
    print_status "warn" "Tempo trace API may not be accessible"
fi

echo ""

# ============================================
# Test 9: Prometheus Scraping ServalSheets
# ============================================
echo -e "${BLUE}Testing Prometheus Scraping...${NC}"

# Check if Prometheus has ServalSheets as a target
if curl -f -s "http://localhost:9090/api/v1/targets" | jq -e '.data.activeTargets[] | select(.labels.job == "servalsheets")' > /dev/null 2>&1; then
    print_status "pass" "Prometheus is configured to scrape ServalSheets"

    # Check if target is up
    if curl -f -s "http://localhost:9090/api/v1/targets" | jq -e '.data.activeTargets[] | select(.labels.job == "servalsheets") | select(.health == "up")' > /dev/null 2>&1; then
        print_status "pass" "ServalSheets target is healthy in Prometheus"
    else
        print_status "fail" "ServalSheets target is down in Prometheus"
    fi
else
    print_status "warn" "ServalSheets is not configured as a Prometheus target"
    print_status "info" "Add ServalSheets to deployment/prometheus/prometheus.yml"
fi

echo ""

# ============================================
# Test 10: Alert Rules Loaded
# ============================================
echo -e "${BLUE}Testing Alert Rules...${NC}"

if curl -f -s "http://localhost:9090/api/v1/rules" | jq -e '.data.groups[].name' > /dev/null 2>&1; then
    local rule_groups=$(curl -f -s "http://localhost:9090/api/v1/rules" | jq -r '.data.groups[].name' | wc -l)
    print_status "pass" "Prometheus has $rule_groups alert rule groups loaded"

    # Check for ServalSheets specific rules
    if curl -f -s "http://localhost:9090/api/v1/rules" | jq -e '.data.groups[] | select(.name | contains("servalsheets"))' > /dev/null 2>&1; then
        print_status "pass" "ServalSheets alert rules are loaded"
    else
        print_status "warn" "ServalSheets alert rules may not be loaded"
    fi
else
    print_status "fail" "Could not retrieve alert rules from Prometheus"
fi

echo ""

# ============================================
# Test 11: Grafana Dashboards
# ============================================
echo -e "${BLUE}Testing Grafana Dashboards...${NC}"

# Check if dashboards are provisioned
if curl -f -s -u admin:admin "http://localhost:3001/api/search?type=dash-db" | jq -e '.[] | select(.title | contains("ServalSheets"))' > /dev/null 2>&1; then
    local dashboard_count=$(curl -f -s -u admin:admin "http://localhost:3001/api/search?type=dash-db" | jq '[.[] | select(.title | contains("ServalSheets"))] | length')
    print_status "pass" "Found $dashboard_count ServalSheets dashboards in Grafana"
else
    print_status "warn" "No ServalSheets dashboards found in Grafana"
    print_status "info" "Import dashboards from deployment/grafana/dashboards/"
fi

echo ""

# ============================================
# Test 12: Log Aggregation
# ============================================
echo -e "${BLUE}Testing Log Aggregation...${NC}"

# Check if Loki has received logs
if curl -f -s "http://localhost:3100/loki/api/v1/labels" | jq -e '.data[]' > /dev/null 2>&1; then
    print_status "pass" "Loki has log labels (receiving logs)"

    # Check for ServalSheets logs
    if curl -f -s "http://localhost:3100/loki/api/v1/label/service/values" | jq -e '.data[] | select(. == "servalsheets")' > /dev/null 2>&1; then
        print_status "pass" "Loki is receiving ServalSheets logs"
    else
        print_status "warn" "Loki may not be receiving ServalSheets logs"
    fi
else
    print_status "warn" "Loki may not have received any logs yet"
fi

echo ""

# ============================================
# Test 13: Container Metrics
# ============================================
echo -e "${BLUE}Testing Container Metrics...${NC}"

test_endpoint "Node Exporter" "http://localhost:9100/metrics"
test_endpoint "cAdvisor" "http://localhost:8080/healthz"

echo ""

# ============================================
# Final Summary
# ============================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo -e "${YELLOW}Warnings: $WARNINGS${NC}"

SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
echo ""
echo "Success Rate: $SUCCESS_RATE%"

echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ All critical tests passed!${NC}"
    echo ""
    echo "Monitoring stack is fully operational."
    echo ""
    echo "Access points:"
    echo "  • Prometheus: http://localhost:9090"
    echo "  • Grafana: http://localhost:3001 (admin/admin)"
    echo "  • Alertmanager: http://localhost:9093"
    echo "  • Loki: http://localhost:3100"
    echo "  • Tempo: http://localhost:3200"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    echo ""
    echo "Review the failures above and check:"
    echo "  1. All services are running: docker-compose ps"
    echo "  2. Check service logs: docker-compose logs [service-name]"
    echo "  3. Verify network connectivity"
    echo ""
    exit 1
fi
