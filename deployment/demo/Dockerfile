# ServalSheets Demo - Cloud Run Deployment
# Read-only demo instance with rate limiting

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 servalsheets

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server.json ./

# Copy demo landing page
COPY deployment/demo/index.html ./public/index.html

# Set demo environment
ENV NODE_ENV=production
ENV DEMO_MODE=true
ENV READ_ONLY=true
ENV HTTP_PORT=8080
ENV LOG_LEVEL=info
ENV LOG_FORMAT=json
ENV RATE_LIMIT_MAX_REQUESTS=30
ENV RATE_LIMIT_WINDOW_MS=60000

# Use non-root user
USER servalsheets

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/http-server.js"]
