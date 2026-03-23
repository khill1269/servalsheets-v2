---
title: Docker Deployment
category: general
last_updated: 2026-01-31
description: Deploy ServalSheets using Docker for quick setup and easy management.
version: 1.6.0
tags: [deployment, docker, kubernetes]
---

# Docker Deployment

Deploy ServalSheets using Docker for quick setup and easy management.

## Prerequisites

- Docker 20.10+
- Google service account JSON file

## Quick Start

```bash
# Pull or build image
docker build -t servalsheets:latest .

# Run with service account
docker run -d \
  --name servalsheets \
  -p 3000:3000 \
  -v /path/to/service-account.json:/etc/google/service-account.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/etc/google/service-account.json \
  -e NODE_ENV=production \
  servalsheets:latest
```

## Docker Compose

For production deployments with additional services:

```yaml
# docker-compose.yml
version: '3.8'

services:
  servalsheets:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - HTTP_PORT=3000
      - LOG_LEVEL=info
      - GOOGLE_APPLICATION_CREDENTIALS=/etc/google/service-account.json
    volumes:
      - ./service-account.json:/etc/google/service-account.json:ro
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  # Optional: Redis for HA sessions
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

Start:

```bash
docker-compose up -d
```

## Environment Variables

| Variable                         | Required | Default | Description                   |
| -------------------------------- | -------- | ------- | ----------------------------- |
| `NODE_ENV`                       | Yes      | -       | `production` or `development` |
| `HTTP_PORT`                      | No       | `3000`  | HTTP server port              |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes      | -       | Path to service account       |
| `LOG_LEVEL`                      | No       | `info`  | Log verbosity                 |
| `RATE_LIMIT_MAX_REQUESTS`        | No       | `100`   | Max requests per window       |

## Health Check

```bash
# Check container health
docker inspect servalsheets --format='{{.State.Health.Status}}'

# View health endpoint
curl http://localhost:3000/health
```

## Logs

```bash
# Stream logs
docker logs -f servalsheets

# Last 100 lines
docker logs --tail 100 servalsheets
```

## Updating

```bash
# Pull latest
docker pull servalsheets:latest

# Restart with new image
docker-compose up -d --force-recreate
```

## Resource Limits

```yaml
services:
  servalsheets:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

## Next Steps

- [Kubernetes](./kubernetes) - Container orchestration
- [Monitoring](./monitoring) - Observability setup
- [Security](/SECURITY) - Security best practices
