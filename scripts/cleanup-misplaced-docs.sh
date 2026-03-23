#!/usr/bin/env bash
# Cleanup misplaced documentation files
# Usage: bash scripts/cleanup-misplaced-docs.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🧪 DRY RUN MODE - No files will be moved"
  echo ""
fi

function move_file() {
  local src="$1"
  local dest="$2"

  if [[ ! -f "$src" ]]; then
    echo "⏭️  Skipping $src (not found)"
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "Would move: $src → $dest"
  else
    mkdir -p "$(dirname "$dest")"
    mv "$src" "$dest"
    echo "✅ Moved: $src → $dest"
  fi
}

function archive_file() {
  local src="$1"
  local reason="$2"
  local dest="docs/archive/2026-01-cleanup/$(basename "$src")"

  if [[ ! -f "$src" ]]; then
    echo "⏭️  Skipping $src (not found)"
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "Would archive: $src → $dest ($reason)"
  else
    mkdir -p "docs/archive/2026-01-cleanup"
    mv "$src" "$dest"
    echo "📦 Archived: $src → $dest ($reason)"
  fi
}

echo "📂 Organizing misplaced documentation files"
echo ""

# === Business documents ===
echo "== Moving business documents to docs/business/ =="
move_file "DEPLOYMENT_AND_MARKETING_PARTNERS.md" "docs/business/DEPLOYMENT_AND_MARKETING_PARTNERS.md"
move_file "MONETIZATION_PROTECTION_VIRAL_IMPLEMENTATION.md" "docs/business/MONETIZATION_PROTECTION_VIRAL_IMPLEMENTATION.md"
move_file "ServalSheets_Comprehensive_Valuation_Report.md" "docs/business/ServalSheets_Comprehensive_Valuation_Report.md"
move_file "Valuation_Evidence_Breakdown.md" "docs/business/Valuation_Evidence_Breakdown.md"
echo ""

# === Development/Testing documents ===
echo "== Moving development documents to docs/development/ =="
move_file "TEST_SUITE_IMPROVEMENT_PLAN.md" "docs/development/TEST_SUITE_IMPROVEMENT_PLAN.md"
move_file "ServalSheets_Testing_Architecture_Analysis.md" "docs/development/ServalSheets_Testing_Architecture_Analysis.md"
echo ""

# === Duplicates (archive) ===
echo "== Archiving duplicate files =="
if [[ -f "TESTING_GUIDE.md" ]] && [[ -f "docs/development/TESTING.md" ]]; then
  archive_file "TESTING_GUIDE.md" "duplicate of docs/development/TESTING.md"
fi

if [[ -f "CLAUDE_DESKTOP_SETUP.md" ]] && [[ -f "docs/guides/CLAUDE_DESKTOP_SETUP.md" ]]; then
  archive_file "CLAUDE_DESKTOP_SETUP.md" "duplicate of docs/guides/CLAUDE_DESKTOP_SETUP.md"
fi

if [[ -f "DOCUMENTATION_AUDIT_REPORT.md" ]] && [[ -f "docs/DOCUMENTATION_AUDIT_REPORT.md" ]]; then
  archive_file "DOCUMENTATION_AUDIT_REPORT.md" "duplicate of docs/DOCUMENTATION_AUDIT_REPORT.md"
fi
echo ""

# === Word documents ===
echo "== Handling Word documents =="
if [[ -d "reports" ]] || [[ "$DRY_RUN" == "false" ]]; then
  mkdir -p reports

  for docx in TESTING_INFRASTRUCTURE_ANALYSIS.docx ServalSheets_Testing_Architecture_Analysis.docx LIVE_API_TESTING_ANALYSIS.docx; do
    if [[ -f "$docx" ]]; then
      if [[ "$DRY_RUN" == "true" ]]; then
        echo "Would move: $docx → reports/$docx"
      else
        mv "$docx" "reports/$docx"
        echo "✅ Moved: $docx → reports/$docx"
      fi
    fi
  done
fi
echo ""

# === Summary ===
echo "✨ Cleanup complete!"
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo "💡 Run without --dry-run to apply changes"
fi
