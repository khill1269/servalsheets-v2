#!/bin/bash

# ServalSheets - Quick Test Script

# Add gcloud to PATH
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   ServalSheets - Quick Test${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if built
if [ ! -d "dist" ]; then
    echo -e "${YELLOW}Building project...${NC}"
    npm run build
    echo ""
fi

# Test mode selection
echo "Select test mode:"
echo "  1) HTTP Server (test via curl)"
echo "  2) STDIO Server (test via echo)"
echo "  3) Check configuration only"
echo ""
read -p "Enter choice (1-3): " choice
echo ""

case $choice in
    1)
        echo -e "${YELLOW}Starting HTTP server on port 3000...${NC}"
        echo "Press Ctrl+C to stop"
        echo ""
        node dist/cli.js --http --port 3000
        ;;
    2)
        echo -e "${YELLOW}Testing STDIO server...${NC}"
        echo ""
        echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/cli.js --stdio
        ;;
    3)
        echo -e "${YELLOW}Configuration Check:${NC}"
        echo ""

        # Check environment
        if [ -f ".env" ]; then
            echo -e "${GREEN}✓ .env file exists${NC}"
        else
            echo -e "${RED}✗ .env file missing${NC}"
        fi

        # Check dist
        if [ -d "dist" ]; then
            echo -e "${GREEN}✓ Project built${NC}"
        else
            echo -e "${RED}✗ Project not built (run: npm run build)${NC}"
        fi

        # Check node version
        NODE_VERSION=$(node --version)
        echo -e "${GREEN}✓ Node.js: $NODE_VERSION${NC}"

        # Check package
        if [ -f "package.json" ]; then
            PACKAGE_VERSION=$(node -p "require('./package.json').version")
            echo -e "${GREEN}✓ ServalSheets: v$PACKAGE_VERSION${NC}"
        fi

        echo ""
        echo "To test the server:"
        echo "  HTTP:  ./scripts/test-servalsheets.sh (choose option 1)"
        echo "  STDIO: ./scripts/test-servalsheets.sh (choose option 2)"
        echo ""
        echo "To use with Claude Desktop:"
        echo "  See: docs/setup/claude-desktop-config.md"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
