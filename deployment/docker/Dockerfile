# ServalSheets Deployment Dockerfile
# Used by deploy.sh and CodeBuild pipeline

FROM public.ecr.aws/docker/library/node:25-alpine AS builder

WORKDIR /app

ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files first to maximize Docker layer cache hits
COPY package*.json ./
COPY packages/serval-core/package*.json ./packages/serval-core/

RUN npm ci

COPY . .

RUN npm run build
RUN npm prune --production

# Production image
FROM public.ecr.aws/docker/library/node:25-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.json ./
COPY --from=builder /app/packages/serval-core ./packages/serval-core

# Recreate workspace symlink (Docker multi-stage COPY does not preserve them)
RUN mkdir -p node_modules/@serval && \
    ln -sf ../../packages/serval-core node_modules/@serval/core

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
