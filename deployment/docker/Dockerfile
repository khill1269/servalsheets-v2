# ServalSheets Deployment Dockerfile
# Used by deploy.sh and CodeBuild pipeline

FROM public.ecr.aws/docker/library/node:20-alpine AS builder

WORKDIR /app

ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files first to maximize Docker layer cache hits
COPY package*.json ./
COPY packages/serval-core/package*.json ./packages/serval-core/
COPY packages/mcp-client/package*.json ./packages/mcp-client/
COPY packages/mcp-http/package*.json ./packages/mcp-http/
COPY packages/mcp-runtime/package*.json ./packages/mcp-runtime/
COPY packages/mcp-stdio/package*.json ./packages/mcp-stdio/

RUN npm ci

COPY . .

RUN npm run build
RUN npm prune --production

# Production image
FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.json ./
COPY --from=builder /app/packages ./packages

# Recreate workspace symlinks (Docker multi-stage COPY does not preserve them)
RUN mkdir -p node_modules/@serval && \
    ln -sf ../../packages/serval-core node_modules/@serval/core && \
    ln -sf ../../packages/mcp-http node_modules/@serval/mcp-http && \
    ln -sf ../../packages/mcp-client node_modules/@serval/mcp-client && \
    ln -sf ../../packages/mcp-runtime node_modules/@serval/mcp-runtime && \
    ln -sf ../../packages/mcp-stdio node_modules/@serval/mcp-stdio

RUN addgroup -g 1001 -S servalsheets && \
    adduser -S servalsheets -u 1001
RUN chown -R servalsheets:servalsheets /app

USER servalsheets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

ENV MCP_TRANSPORT=http
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/http-server.js"]
