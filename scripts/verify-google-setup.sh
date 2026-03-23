#!/bin/bash

# ServalSheets - Google Cloud Setup Verification Script

# Add gcloud to PATH
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

PROJECT_ID="serval-sheets"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   ServalSheets - Setup Verification${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check gcloud installation
echo -e "${YELLOW}Checking gcloud installation...${NC}"
if command -v gcloud &> /dev/null; then
    echo -e "${GREEN}✓ gcloud installed: $(gcloud version | head -1)${NC}"
else
    echo -e "${RED}✗ gcloud not found in PATH${NC}"
    exit 1
fi
echo ""

# Check authentication
echo -e "${YELLOW}Checking authentication...${NC}"
ACCOUNT=$(gcloud config get-value account 2>/dev/null)
if [ -n "$ACCOUNT" ]; then
    echo -e "${GREEN}✓ Authenticated as: $ACCOUNT${NC}"
else
    echo -e "${RED}✗ Not authenticated${NC}"
    echo "  Run: gcloud auth login"
fi
echo ""

# Check active project
echo -e "${YELLOW}Checking active project...${NC}"
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" = "$PROJECT_ID" ]; then
    echo -e "${GREEN}✓ Active project: $PROJECT_ID${NC}"
elif [ -n "$CURRENT_PROJECT" ]; then
    echo -e "${YELLOW}⚠ Active project is: $CURRENT_PROJECT${NC}"
    echo "  Expected: $PROJECT_ID"
    echo "  Run: gcloud config set project $PROJECT_ID"
else
    echo -e "${RED}✗ No project set${NC}"
    echo "  Run: gcloud config set project $PROJECT_ID"
fi
echo ""

# Check enabled APIs
echo -e "${YELLOW}Checking enabled APIs...${NC}"
REQUIRED_APIS=(
    "sheets.googleapis.com:Google Sheets API"
    "drive.googleapis.com:Google Drive API"
    "script.googleapis.com:Apps Script API"
    "bigquery.googleapis.com:BigQuery API"
    "iam.googleapis.com:IAM API"
)

for api_info in "${REQUIRED_APIS[@]}"; do
    IFS=':' read -r api name <<< "$api_info"
    if gcloud services list --enabled --project=$PROJECT_ID 2>/dev/null | grep -q "$api"; then
        echo -e "${GREEN}✓${NC} $name"
    else
        echo -e "${RED}✗${NC} $name (not enabled)"
        echo "  Run: gcloud services enable $api"
    fi
done
echo ""

# Check Application Default Credentials
echo -e "${YELLOW}Checking Application Default Credentials...${NC}"
if gcloud auth application-default print-access-token &> /dev/null; then
    echo -e "${GREEN}✓ Application Default Credentials configured${NC}"
else
    echo -e "${RED}✗ Application Default Credentials not set${NC}"
    echo "  Run: gcloud auth application-default login"
fi
echo ""

# Check .env file
echo -e "${YELLOW}Checking .env configuration...${NC}"
if [ -f ".env" ]; then
    echo -e "${GREEN}✓ .env file exists${NC}"

    # Check for required variables
    if grep -q "OAUTH_CLIENT_ID" .env; then
        echo -e "${GREEN}  ✓ OAUTH_CLIENT_ID configured${NC}"
    else
        echo -e "${RED}  ✗ OAUTH_CLIENT_ID missing${NC}"
    fi

    if grep -q "OAUTH_CLIENT_SECRET" .env; then
        echo -e "${GREEN}  ✓ OAUTH_CLIENT_SECRET configured${NC}"
    else
        echo -e "${RED}  ✗ OAUTH_CLIENT_SECRET missing${NC}"
    fi

    if grep -q "OAUTH_REDIRECT_URI" .env; then
        echo -e "${GREEN}  ✓ OAUTH_REDIRECT_URI configured${NC}"
    else
        echo -e "${RED}  ✗ OAUTH_REDIRECT_URI missing${NC}"
    fi
else
    echo -e "${RED}✗ .env file not found${NC}"
    echo "  Copy .env.example to .env and configure"
fi
echo ""

# Check service accounts
echo -e "${YELLOW}Checking service accounts...${NC}"
SA_COUNT=$(gcloud iam service-accounts list --project="$PROJECT_ID" 2>/dev/null | grep -c "@${PROJECT_ID}.iam.gserviceaccount.com") || SA_COUNT=0
if [ "$SA_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Found $SA_COUNT service account(s)${NC}"
    gcloud iam service-accounts list --project=$PROJECT_ID 2>/dev/null | tail -n +2
else
    echo -e "${YELLOW}⚠ No service accounts found${NC}"
fi
echo ""

# Check OAuth credentials
echo -e "${YELLOW}Checking OAuth2 credentials...${NC}"
echo "Opening credentials page..."
echo "  URL: https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""

# Build status
echo -e "${YELLOW}Checking project build...${NC}"
if [ -d "dist" ]; then
    echo -e "${GREEN}✓ Project built (dist/ exists)${NC}"
else
    echo -e "${YELLOW}⚠ Project not built${NC}"
    echo "  Run: npm run build"
fi
echo ""

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Verification Complete${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo "  1. Fix any issues marked with ✗"
echo "  2. Run setup script: ./scripts/setup-google-cloud.sh"
echo "  3. Test ServalSheets: npm run dev"
echo ""
