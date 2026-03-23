#!/bin/bash
# Manual deployment script for ServalSheets Demo to Google Cloud Run
# Usage: ./deploy.sh [project-id]

set -e

# Configuration
PROJECT_ID="${1:-serval-sheets-484605}"
REGION="us-central1"
SERVICE_NAME="servalsheets-demo"
IMAGE_NAME="servalsheets-demo"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        ServalSheets Demo - Cloud Run Deployment           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker not found.${NC}"
    exit 1
fi

# Authenticate
echo -e "${YELLOW}Authenticating with Google Cloud...${NC}"
gcloud auth print-identity-token > /dev/null 2>&1 || gcloud auth login

# Set project
echo -e "${YELLOW}Setting project to: ${PROJECT_ID}${NC}"
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo -e "${YELLOW}Enabling required APIs...${NC}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# Create Artifact Registry repository (if not exists)
echo -e "${YELLOW}Creating Artifact Registry repository...${NC}"
gcloud artifacts repositories create servalsheets \
    --repository-format=docker \
    --location="$REGION" \
    --description="ServalSheets container images" 2>/dev/null || true

# Configure Docker for Artifact Registry
echo -e "${YELLOW}Configuring Docker authentication...${NC}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# Build image
echo -e "${YELLOW}Building Docker image...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

docker build \
    -f deployment/demo/Dockerfile \
    -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/servalsheets/${IMAGE_NAME}:latest" \
    .

# Push image
echo -e "${YELLOW}Pushing image to Artifact Registry...${NC}"
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/servalsheets/${IMAGE_NAME}:latest"

# Check if secret exists
echo -e "${YELLOW}Checking for service account secret...${NC}"
if ! gcloud secrets describe servalsheets-demo-credentials --project="$PROJECT_ID" > /dev/null 2>&1; then
    echo -e "${YELLOW}Creating secret for service account credentials...${NC}"
    echo -e "${RED}Please provide the service account JSON file path:${NC}"
    read -r SA_FILE
    if [ -f "$SA_FILE" ]; then
        gcloud secrets create servalsheets-demo-credentials \
            --data-file="$SA_FILE" \
            --project="$PROJECT_ID"
    else
        echo -e "${RED}File not found. Please create the secret manually:${NC}"
        echo "gcloud secrets create servalsheets-demo-credentials --data-file=<path-to-sa.json>"
    fi
fi

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
gcloud run deploy "$SERVICE_NAME" \
    --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/servalsheets/${IMAGE_NAME}:latest" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 3 \
    --port 8080 \
    --set-env-vars "DEMO_MODE=true,READ_ONLY=true,RATE_LIMIT_MAX_REQUESTS=30,LOG_LEVEL=info" \
    --set-secrets "GOOGLE_APPLICATION_CREDENTIALS_JSON=servalsheets-demo-credentials:latest"

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region "$REGION" \
    --format 'value(status.url)')

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                 Deployment Complete!                      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Service URL: ${SERVICE_URL}${NC}"
echo ""
echo "Test with:"
echo "  curl ${SERVICE_URL}/health"
echo "  npx @modelcontextprotocol/inspector ${SERVICE_URL}"
