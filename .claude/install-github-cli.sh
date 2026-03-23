#!/bin/bash
# GitHub CLI Installation & Setup Script
# Usage: ./.claude/install-github-cli.sh

set -e

echo "🐙 GitHub CLI Installation & Setup"
echo "===================================="
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
  echo "❌ Homebrew not found. Install from: https://brew.sh"
  exit 1
fi
echo "✓ Homebrew installed"
echo ""

# Check if gh is already installed
if command -v gh &> /dev/null; then
  echo "✓ GitHub CLI already installed ($(gh --version | head -1))"
  echo ""
else
  # Install GitHub CLI
  echo "📥 Installing GitHub CLI..."
  brew install gh
  echo "✓ GitHub CLI installed"
  echo ""
fi

# Check authentication status
echo "🔐 Checking authentication..."
if gh auth status &> /dev/null; then
  echo "✓ Already authenticated with GitHub"
  gh auth status
else
  echo "⚠️  Not authenticated. Starting login flow..."
  echo ""
  gh auth login
fi
echo ""

# Configure git to use gh as credential helper
echo "⚙️  Configuring git credential helper..."
gh auth setup-git
echo "✓ Git configured to use GitHub CLI"
echo ""

# Test GitHub API access
echo "🧪 Testing GitHub API access..."
if gh api user &> /dev/null; then
  USER=$(gh api user -q .login)
  echo "✓ Successfully authenticated as: $USER"
else
  echo "❌ Failed to access GitHub API"
  exit 1
fi
echo ""

# Check ServalSheets repository access
echo "📦 Checking repository access..."
REPO_PATH="/Users/thomascahill/Documents/servalsheets 2"
cd "$REPO_PATH"
if git remote -v | grep -q "github.com"; then
  REPO=$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')
  if gh repo view "$REPO" &> /dev/null; then
    echo "✓ Repository access confirmed: $REPO"
  else
    echo "⚠️  Cannot access repository: $REPO"
    echo "You may need to fork or request access"
  fi
else
  echo "⚠️  No GitHub remote configured"
  echo "Add remote: git remote add origin <github-url>"
fi
echo ""

# Success summary
echo "✅ GitHub CLI Setup Complete!"
echo ""
echo "Available commands:"
echo "  gh repo view          - View repository details"
echo "  gh pr create          - Create pull request"
echo "  gh pr list            - List pull requests"
echo "  gh issue list         - List issues"
echo "  gh run list           - List workflow runs"
echo "  gh auth refresh       - Refresh authentication"
echo ""
echo "📚 Full documentation: gh help"
echo ""
