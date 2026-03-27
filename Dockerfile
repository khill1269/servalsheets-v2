# ServalSheets Production Dockerfile
# Multi-stage build for optimal image size (~50MB final)
# Supports ARM64 (Graviton) for AgentCore deployment
# Uses ECR Public Gallery to avoid Docker Hub rate limits in CI/CD

# Stage 1: Build
FROM public.ecr.aws/docker/library/node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/serval-core/package*.json ./packages/serval-core/

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Install AWS SDK optional dependencies for TypeScript compilation
RUN npm install --no-save \
  @aws-sdk/client-bedrock-runtime \
  @aws-sdk/client-secrets-manager \
  @aws-sdk/client-cloudwatch-logs \
  2>/dev/null || true

# Build TypeScript
RUN npm run build

# Prune devDependencies
RUN npm prune --production

# Re-install AWS SDK optional dependencies for production runtime
RUN npm install --no-save \
  @aws-sdk/client-bedrock-runtime \
  @aws-sdk/client-secrets-manager \
  @aws-sdk/client-cloudwatch-logs \
  2>/dev/null || true

# Stage 2: Runtime
FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.json ./

# Create non-root user
RUN addgroup -g 1001 -S servalsheets && \
    adduser -S servalsheets -u 1001

# Change ownership
RUN chown -R servalsheets:servalsheets /app

# Switch to non-root user
USER servalsheets

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

# Default to HTTP transport for AgentCore
ENV MCP_TRANSPORT=http
ENV NODE_ENV=production
ENV PORT=3000

# AWS/AgentCore defaults (overridden by ECS task definition)
ENV LLM_PROVIDER=bedrock
ENV CLOUDWATCH_LOGS_ENABLED=true
ENV CLOUDWATCH_LOG_GROUP=/servalsheets/mcp-server
ENV AWS_REGION=us-east-1

# Start server
CMD ["node", "dist/http-server.js"]
