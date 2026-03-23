#!/usr/bin/env bash
set -euo pipefail

# Workspace cleanup helper.
# Default behavior is dry-run. Nothing is removed unless an apply flag is provided.

SAFE_TARGETS=(
  "dist"
  "coverage"
  "audit-output"
  ".performance-history"
  ".data"
)

OPTIONAL_TARGETS=(
  "src/ui/tracing-dashboard/node_modules"
  ".claude/worktrees"
)

AGGRESSIVE_TARGETS=(
  "node_modules"
)

MODE="${1:---dry-run}"

print_target() {
  local target="$1"
  if [[ -e "$target" ]]; then
    local files
    files="$(find "$target" -type f 2>/dev/null | wc -l | tr -d ' ')"
    local size
    size="$(du -sh "$target" 2>/dev/null | awk '{print $1}')"
    printf "%-40s files=%-10s size=%s\n" "$target" "$files" "$size"
  else
    printf "%-40s missing\n" "$target"
  fi
}

print_section() {
  local title="$1"
  shift
  echo
  echo "$title"
  echo "----------------------------------------"
  for t in "$@"; do
    print_target "$t"
  done
}

remove_targets() {
  for t in "$@"; do
    if [[ -e "$t" ]]; then
      echo "Removing $t"
      rm -rf "$t"
    else
      echo "Skipping $t (not found)"
    fi
  done
}

case "$MODE" in
  --dry-run)
    echo "Workspace cleanup dry-run (no changes)."
    print_section "Safe targets" "${SAFE_TARGETS[@]}"
    print_section "Optional targets" "${OPTIONAL_TARGETS[@]}"
    print_section "Aggressive targets" "${AGGRESSIVE_TARGETS[@]}"
    ;;
  --apply-safe)
    echo "Applying SAFE cleanup targets."
    remove_targets "${SAFE_TARGETS[@]}"
    ;;
  --apply-optional)
    echo "Applying OPTIONAL cleanup targets."
    remove_targets "${OPTIONAL_TARGETS[@]}"
    ;;
  --apply-aggressive)
    echo "Applying AGGRESSIVE cleanup targets (safe + optional + aggressive)."
    remove_targets "${SAFE_TARGETS[@]}" "${OPTIONAL_TARGETS[@]}" "${AGGRESSIVE_TARGETS[@]}"
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage:"
    echo "  scripts/analysis/workspace-cleanup.sh --dry-run"
    echo "  scripts/analysis/workspace-cleanup.sh --apply-safe"
    echo "  scripts/analysis/workspace-cleanup.sh --apply-optional"
    echo "  scripts/analysis/workspace-cleanup.sh --apply-aggressive"
    exit 1
    ;;
esac
