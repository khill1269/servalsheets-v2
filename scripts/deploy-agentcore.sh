#!/usr/bin/env bash
# ServalSheets — Deploy to AgentCore (ECR + ECS Fargate)
#
# Usage:
#   ./scripts/deploy-agentcore.sh              # Build, push, and register task
#   ./scripts/deploy-agentcore.sh --push-only  # Skip build, just push + register
#   ./scripts/deploy-agentcore.sh --dry-run    # Show what would happen
#
# Prerequisites:
#   - Docker with buildx (for ARM64 cross-compilation)
#   - AWS CLI v2 configured with appropriate credentials
#   - ECR repo: 050752643237.dkr.ecr.us-east-1.amazonaws.com/servalsheets/mcp-server
#
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
AWS_ACCOUNT_ID="050752643237"
AWS_REGION="us-east-1"
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/servalsheets/mcp-server"
TASK_DEF_FILE="deploy/agentcore-task-definition.json"
PLATFORM="linux/arm64"

# Git-based tagging
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
IMAGE_TAG="${GIT_TAG:-${GIT_SHA}}"

# ── Flags ───────────────────────────────────────────────────────────────────
DRY_RUN=false
PUSH_ONLY=false

for arg in "$@"; do
  case $arg in
    --dry-run)   DRY_RUN=true ;;
    --push-only) PUSH_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--push-only] [--dry-run] [--help]"
      exit 0
      ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m    $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
err()   { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

run() {
  if $DRY_RUN; then
    info "[dry-run] $*"
  else
    "$@"
  fi
}

# ── Preflight checks ───────────────────────────────────────────────────────
info "ServalSheets AgentCore Deploy"
info "Image: ${ECR_REPO}:${IMAGE_TAG}"
info "Platform: ${PLATFORM}"
echo ""

# Check Docker
if ! command -v docker &>/dev/null; then
  err "Docker not found. Install Docker Desktop or Docker Engine."
  exit 1
fi

# Check AWS CLI
if ! command -v aws &>/dev/null; then
  err "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
  exit 1
fi

# Check task definition file
if [[ ! -f "$TASK_DEF_FILE" ]]; then
  err "Task definition not found: ${TASK_DEF_FILE}"
  exit 1
fi

# Verify AWS identity
info "Verifying AWS credentials..."
AWS_IDENTITY=$(aws sts get-caller-identity --output json 2>/dev/null || echo "")
if [[ -z "$AWS_IDENTITY" ]]; then
  err "AWS credentials not configured. Run: aws configure"
  exit 1
fi
ok "AWS identity: $(echo "$AWS_IDENTITY" | jq -r '.Arn')"

# ── Step 1: ECR Login ──────────────────────────────────────────────────────
info "Logging in to ECR..."
run aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ok "ECR login successful"

# ── Step 2: Build (ARM64) ──────────────────────────────────────────────────
if ! $PUSH_ONLY; then
  info "Building ARM64 image..."

  # Ensure buildx builder exists
  if ! docker buildx inspect servalsheets-builder &>/dev/null; then
    info "Creating buildx builder..."
    run docker buildx create --name servalsheets-builder --use
  else
    run docker buildx use servalsheets-builder
  fi

  run docker buildx build \
    --platform "${PLATFORM}" \
    --tag "${ECR_REPO}:${IMAGE_TAG}" \
    --tag "${ECR_REPO}:latest" \
    --push \
    --file Dockerfile \
    .

  ok "Image built and pushed: ${ECR_REPO}:${IMAGE_TAG}"
else
  info "Skipping build (--push-only)"
fi

# ── Step 3: Update task definition image tag ────────────────────────────────
info "Updating task definition with image tag: ${IMAGE_TAG}..."
TASK_DEF_CONTENT=$(cat "$TASK_DEF_FILE" | \
  jq --arg img "${ECR_REPO}:${IMAGE_TAG}" \
    '.containerDefinitions[0].image = $img')

# ── Step 4: Register ECS task definition ────────────────────────────────────
info "Registering ECS task definition..."
if $DRY_RUN; then
  info "[dry-run] Would register task definition: servalsheets-mcp-server"
  echo "$TASK_DEF_CONTENT" | jq '.family'
else
  REGISTER_RESULT=$(echo "$TASK_DEF_CONTENT" | \
    aws ecs register-task-definition \
      --cli-input-json file:///dev/stdin \
      --region "${AWS_REGION}" \
      --output json)

  TASK_REVISION=$(echo "$REGISTER_RESULT" | jq -r '.taskDefinition.revision')
  TASK_ARN=$(echo "$REGISTER_RESULT" | jq -r '.taskDefinition.taskDefinitionArn')
  ok "Task definition registered: servalsheets-mcp-server:${TASK_REVISION}"
  ok "ARN: ${TASK_ARN}"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
info "╔══════════════════════════════════════════════════════════╗"
info "║          ServalSheets AgentCore Deploy Complete          ║"
info "╠══════════════════════════════════════════════════════════╣"
info "║  Image:    ${ECR_REPO}:${IMAGE_TAG}"
info "║  Platform: ARM64 (Graviton)"
info "║  Region:   ${AWS_REGION}"
if ! $DRY_RUN && ! $PUSH_ONLY; then
  info "║  Task:     servalsheets-mcp-server:${TASK_REVISION}"
fi
info "╚══════════════════════════════════════════════════════════╝"
echo ""

if ! $DRY_RUN; then
  info "Next steps:"
  info "  1. Create/update ECS service to use the new task revision"
  info "  2. Verify health check passes: curl http://<service-url>:3000/health/live"
  info "  3. Monitor CloudWatch logs: /servalsheets/mcp-server"
fi
