#!/bin/bash
# ServalSheets One-Command Setup Script
# Run this after cloning the repository: ./.claude/init.sh

set -e  # Exit on error

echo "🚀 ServalSheets Setup"
echo "===================="
echo ""

# Check Node.js version
echo "📦 Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi
echo "✓ Node.js $(node -v)"
echo ""

# Install dependencies
echo "📥 Installing dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Build project
echo "🔨 Building project..."
npm run build
echo "✓ Build complete"
echo ""

# Run verification
echo "🧪 Running verification..."
npm run typecheck
npm run check:drift
echo "✓ Verification passed"
echo ""

# Check if OAuth credentials exist
echo "🔐 Checking OAuth setup..."
if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found"
  echo ""
  echo "Next step: Configure OAuth credentials"
  echo "Run: npm run auth:setup"
  echo ""
else
  echo "✓ .env file found"
fi

# Check GitHub CLI
echo "🐙 Checking GitHub CLI..."
if command -v gh &> /dev/null; then
  echo "✓ GitHub CLI installed"
  if gh auth status &> /dev/null; then
    echo "✓ GitHub CLI authenticated"
  else
    echo "⚠️  GitHub CLI not authenticated"
    echo "Run: gh auth login"
  fi
else
  echo "⚠️  GitHub CLI not installed"
  echo "Install: brew install gh"
  echo "Then run: gh auth login"
fi
echo ""

# Success summary
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "  1. Configure OAuth: npm run auth:setup (if needed)"
echo "  2. Install GitHub CLI: brew install gh && gh auth login (if needed)"
echo "  3. Run tests: npm test"
echo "  4. Start MCP server: npm run dev"
echo ""
echo "📚 Documentation:"
echo "  - Quick Start: .claude/QUICK_START.md"
echo "  - Keyboard Shortcuts: docs/development/KEYBOARD_SHORTCUTS_REFERENCE.md"
echo "  - Agent Templates: .claude/agent-templates/README.md"
echo ""
echo "Happy coding! 🎉"
