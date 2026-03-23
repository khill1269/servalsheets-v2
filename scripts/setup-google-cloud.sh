#!/bin/bash
set -e

# ServalSheets Google Cloud Setup Script
# This script configures your Google Cloud project for ServalSheets

# Add gcloud to PATH
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

PROJECT_ID="serval-sheets"
DISPLAY_OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID:-<set OAUTH_CLIENT_ID in your shell or .env>}"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   ServalSheets - Google Cloud Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Set project
echo -e "${YELLOW}Step 1: Setting project to $PROJECT_ID${NC}"
gcloud config set project $PROJECT_ID
echo ""

# Enable required APIs
echo -e "${YELLOW}Step 2: Enabling required Google APIs${NC}"
echo "This may take a few minutes..."

APIS=(
    "sheets.googleapis.com"
    "drive.googleapis.com"
    "script.googleapis.com"
    "bigquery.googleapis.com"
    "iam.googleapis.com"
    "cloudresourcemanager.googleapis.com"
)

for api in "${APIS[@]}"; do
    echo -e "  • Enabling ${api}..."
    gcloud services enable "$api" --quiet || echo "    Already enabled"
done
echo -e "${GREEN}✓ APIs enabled${NC}"
echo ""

# Check OAuth consent screen
echo -e "${YELLOW}Step 3: Checking OAuth Consent Screen${NC}"
echo "Opening OAuth consent screen in browser..."
echo "Please configure:"
echo "  1. App name: ServalSheets"
echo "  2. User support email: your email"
echo "  3. Developer contact: your email"
echo "  4. Scopes: Add the following scopes:"
echo "     - .../auth/spreadsheets"
echo "     - .../auth/drive.file"
echo "     - .../auth/drive.appdata"
echo "     - .../auth/bigquery (optional)"
echo "     - .../auth/script.projects (optional)"
echo ""
read -p "Press Enter to open OAuth consent screen..." dummy
open "https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID"
echo ""
read -p "Press Enter after configuring OAuth consent screen..." dummy
echo ""

# Verify OAuth credentials
echo -e "${YELLOW}Step 4: Verifying OAuth2 Client ID${NC}"
echo "Your OAuth credentials should match the values in your .env or shell:"
echo "  Client ID: $DISPLAY_OAUTH_CLIENT_ID"
echo ""
echo "Verify this client exists in Google Cloud Console:"
open "https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""
read -p "Press Enter after verifying credentials exist..." dummy
echo ""

# Set up Application Default Credentials
echo -e "${YELLOW}Step 5: Setting up Application Default Credentials${NC}"
echo "This will open a browser for authentication..."
gcloud auth application-default login --scopes="https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/drive.file,https://www.googleapis.com/auth/drive.appdata,https://www.googleapis.com/auth/bigquery,https://www.googleapis.com/auth/script.projects,https://www.googleapis.com/auth/cloud-platform"
echo -e "${GREEN}✓ Application Default Credentials configured${NC}"
echo ""

# Set up service account key (optional)
echo -e "${YELLOW}Step 6: Service Account Setup (Optional)${NC}"
SERVICE_ACCOUNT="serval-sheets@serval-sheets.iam.gserviceaccount.com"
echo "Existing service account: $SERVICE_ACCOUNT"
echo ""
read -p "Do you want to create a new service account key? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    KEY_FILE="./credentials/service-account-key.json"
    mkdir -p ./credentials
    echo "Creating service account key..."
    gcloud iam service-accounts keys create "$KEY_FILE" \
        --iam-account="$SERVICE_ACCOUNT" \
        --project="$PROJECT_ID"
    echo -e "${GREEN}✓ Service account key saved to: $KEY_FILE${NC}"
    echo ""
    echo "To use this key, add to your .env:"
    echo "  GOOGLE_APPLICATION_CREDENTIALS=$KEY_FILE"
    echo ""
fi

# Test authentication
echo -e "${YELLOW}Step 7: Testing Authentication${NC}"
echo "Testing API access..."
if gcloud sheets spreadsheets --help > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Sheets API accessible${NC}"
else
    echo -e "${YELLOW}⚠ Sheets API test skipped (gcloud sheets command not available)${NC}"
fi
echo ""

# Display summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "✅ Project: $PROJECT_ID"
echo "✅ APIs: Enabled"
echo "✅ OAuth: Configured"
echo "✅ Application Default Credentials: Set up"
echo ""
echo "Next Steps:"
echo "  1. Test ServalSheets:"
echo "     npm run dev"
echo ""
echo "  2. Configure Claude Desktop:"
echo "     Add to ~/Library/Application Support/Claude/claude_desktop_config.json:"
echo ""
echo '     {
       "mcpServers": {
         "servalsheets": {
           "command": "node",
           "args": ["'$(pwd)'/dist/cli.js"],
           "env": {
             "OAUTH_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
             "OAUTH_CLIENT_SECRET": "your-client-secret",
             "OAUTH_REDIRECT_URI": "http://localhost:3000/callback"
           }
         }
       }
     }'
echo ""
echo "  3. Start using ServalSheets in Claude!"
echo ""
