#!/bin/bash
# ServalSheets Observability Stack Launcher
# Starts Prometheus, Grafana, Alertmanager, Loki, Tempo, and related services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="deployment/observability/docker-compose.yml"
PROJECT_NAME="servalsheets-observability"
TIMEOUT=120

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}ServalSheets Observability Stack Launcher${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to print colored status
print_status() {
    local status=$1
    local message=$2
    case $status in
        "success")
            echo -e "${GREEN}✓${NC} $message"
            ;;
        "error")
            echo -e "${RED}✗${NC} $message"
            ;;
        "warning")
            echo -e "${YELLOW}⚠${NC} $message"
            ;;
        "info")
            echo -e "${BLUE}ℹ${NC} $message"
            ;;
    esac
}

# Function to check if service is healthy
check_service_health() {
    local service=$1
    local port=$2
    local endpoint=$3
    local max_attempts=30
    local attempt=0

    print_status "info" "Checking $service health..."

    while [ $attempt -lt $max_attempts ]; do
        if curl -f -s "http://localhost:$port$endpoint" > /dev/null 2>&1; then
            print_status "success" "$service is healthy"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done

    print_status "error" "$service failed to become healthy"
    return 1
}

# Check if Docker is running
print_status "info" "Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    print_status "error" "Docker is not running. Please start Docker and try again."
    exit 1
fi
print_status "success" "Docker is running"

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    print_status "error" "docker-compose is not installed"
    exit 1
fi
print_status "success" "docker-compose is available"

# Check if compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
    print_status "error" "Compose file not found: $COMPOSE_FILE"
    exit 1
fi

# Stop any existing services
print_status "info" "Stopping any existing observability services..."
docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down 2>/dev/null || true
print_status "success" "Cleaned up existing services"

echo ""
echo -e "${BLUE}Starting observability stack...${NC}"
echo ""

# Start services
print_status "info" "Starting Docker Compose services..."
docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d

if [ $? -ne 0 ]; then
    print_status "error" "Failed to start services"
    exit 1
fi

echo ""
echo -e "${BLUE}Waiting for services to become healthy...${NC}"
echo ""

# Wait for Prometheus
check_service_health "Prometheus" "9090" "/-/healthy"
PROMETHEUS_STATUS=$?

# Wait for Alertmanager
check_service_health "Alertmanager" "9093" "/-/healthy"
ALERTMANAGER_STATUS=$?

# Wait for Grafana
check_service_health "Grafana" "3001" "/api/health"
GRAFANA_STATUS=$?

# Wait for Loki
check_service_health "Loki" "3100" "/ready"
LOKI_STATUS=$?

# Wait for Tempo
check_service_health "Tempo" "3200" "/ready"
TEMPO_STATUS=$?

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Service Status Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check all services
FAILED_SERVICES=0

if [ $PROMETHEUS_STATUS -eq 0 ]; then
    print_status "success" "Prometheus: http://localhost:9090"
else
    print_status "error" "Prometheus: FAILED"
    FAILED_SERVICES=$((FAILED_SERVICES + 1))
fi

if [ $ALERTMANAGER_STATUS -eq 0 ]; then
    print_status "success" "Alertmanager: http://localhost:9093"
else
    print_status "error" "Alertmanager: FAILED"
    FAILED_SERVICES=$((FAILED_SERVICES + 1))
fi

if [ $GRAFANA_STATUS -eq 0 ]; then
    print_status "success" "Grafana: http://localhost:3001 (admin/admin)"
else
    print_status "error" "Grafana: FAILED"
    FAILED_SERVICES=$((FAILED_SERVICES + 1))
fi

if [ $LOKI_STATUS -eq 0 ]; then
    print_status "success" "Loki: http://localhost:3100"
else
    print_status "error" "Loki: FAILED"
    FAILED_SERVICES=$((FAILED_SERVICES + 1))
fi

if [ $TEMPO_STATUS -eq 0 ]; then
    print_status "success" "Tempo: http://localhost:3200"
else
    print_status "error" "Tempo: FAILED"
    FAILED_SERVICES=$((FAILED_SERVICES + 1))
fi

# Additional services (no health check, just verify running)
print_status "info" "Node Exporter: http://localhost:9100"
print_status "info" "cAdvisor: http://localhost:8080"

echo ""

# Show Grafana dashboards
if [ $GRAFANA_STATUS -eq 0 ]; then
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Grafana Dashboards${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    print_status "info" "Overview: http://localhost:3001/d/servalsheets-overview"
    print_status "info" "SLI/SLO: http://localhost:3001/d/servalsheets-slo"
    print_status "info" "Errors: http://localhost:3001/d/servalsheets-errors"
    print_status "info" "Performance: http://localhost:3001/d/servalsheets-performance"
    echo ""
    print_status "warning" "Default credentials: admin / admin (change after first login)"
    echo ""
fi

# Show service logs command
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Useful Commands${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "View all logs:"
echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME logs -f"
echo ""
echo "View specific service logs:"
echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME logs -f prometheus"
echo ""
echo "Stop all services:"
echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME down"
echo ""
echo "Restart a service:"
echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME restart prometheus"
echo ""
echo "Check service status:"
echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME ps"
echo ""

# Show metrics endpoint
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Configure ServalSheets${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Add these environment variables to ServalSheets:"
echo ""
echo "# OpenTelemetry (Traces)"
echo "export OTEL_ENABLED=true"
echo "export OTEL_ENDPOINT=http://localhost:4318"
echo "export OTEL_SERVICE_NAME=servalsheets"
echo ""
echo "# Metrics endpoint (for Prometheus scraping)"
echo "# ServalSheets exposes metrics at: http://localhost:3000/metrics"
echo ""
echo "# Update Prometheus config to scrape ServalSheets:"
echo "# Add to deployment/prometheus/prometheus.yml:"
echo "# - job_name: 'servalsheets'"
echo "#   static_configs:"
echo "#     - targets: ['host.docker.internal:3000']"
echo ""

# Final status
echo -e "${BLUE}========================================${NC}"
if [ $FAILED_SERVICES -eq 0 ]; then
    echo -e "${GREEN}✓ All services started successfully!${NC}"
    echo ""
    print_status "info" "Next steps:"
    echo "  1. Open Grafana at http://localhost:3001"
    echo "  2. Login with admin/admin"
    echo "  3. Navigate to Dashboards > ServalSheets"
    echo "  4. Configure ServalSheets with OTEL settings above"
    echo "  5. Start ServalSheets to see metrics/traces"
    exit 0
else
    echo -e "${RED}✗ $FAILED_SERVICES service(s) failed to start${NC}"
    echo ""
    print_status "error" "Check logs with:"
    echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME logs"
    echo ""
    print_status "info" "Try stopping and restarting:"
    echo "  docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME down"
    echo "  $0"
    exit 1
fi
