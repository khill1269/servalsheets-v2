#!/bin/bash

# ServalSheets - OAuth Configuration Status Check

export PATH="$HOME/google-cloud-sdk/bin:$PATH"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   ServalSheets - OAuth Configuration Status${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get access token
ACCESS_TOKEN=$(gcloud auth print-access-token 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}✗ Not authenticated${NC}"
    echo "  Run: gcloud auth login"
    exit 1
fi

echo -e "${YELLOW}Checking OAuth Brand...${NC}"

# Get OAuth brand info
BRAND_INFO=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://iap.googleapis.com/v1/projects/928247231183/brands" 2>/dev/null)

if echo "$BRAND_INFO" | grep -q "applicationTitle"; then
    echo -e "${GREEN}✓ OAuth Brand exists${NC}"
    echo ""
    echo "$BRAND_INFO" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'brands' in data and len(data['brands']) > 0:
        brand = data['brands'][0]
        print(f\"  Application Title: {brand.get('applicationTitle', 'N/A')}\")
        print(f\"  Support Email: {brand.get('supportEmail', 'N/A')}\")

        org_internal = brand.get('orgInternalOnly', False)
        if org_internal:
            print(f\"  Type: ⚠️  Internal Only (needs to be changed to External)\")
        else:
            print(f\"  Type: ✓ External\")
except:
    print('  Unable to parse brand info')
" 2>/dev/null
else
    echo -e "${RED}✗ OAuth Brand not found or API error${NC}"
    echo "  You need to create it via Google Cloud Console"
fi

echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "Since Google deprecated the OAuth Brand management APIs,"
echo "you need to configure the consent screen via the web UI:"
echo ""
echo "1. Open: https://console.cloud.google.com/apis/credentials/consent?project=serval-sheets"
echo "2. Change User Type from 'Internal' to 'External'"
echo "3. Add the required scopes"
echo "4. Add test user: thomas@cahillfinancialgroup.com"
echo ""
echo "Or follow the detailed guide:"
echo "  cat OAUTH_SETUP_WALKTHROUGH.md"
echo ""
