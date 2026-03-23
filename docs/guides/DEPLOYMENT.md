---
title: Deployment Guide
category: guide
last_updated: 2026-01-31
description: This guide covers deploying ServalSheets in production environments.
version: 1.6.0
tags: [deployment, prometheus, docker, kubernetes]
audience: user
difficulty: intermediate
---

# Deployment Guide

This guide covers deploying ServalSheets in production environments.

## Table of Contents

- [Overview](#overview)
- [Docker Deployment](#docker-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [systemd Service](#systemd-service)
- [PM2 Process Manager](#pm2-process-manager)
- [Cloud Platforms](#cloud-platforms)
- [Load Balancing](#load-balancing)
- [Disaster Recovery](#disaster-recovery)

---

## Overview

ServalSheets can be deployed in multiple ways:

| Method           | Use Case              | Complexity |
| ---------------- | --------------------- | ---------- |
| Docker           | Containerized apps    | Low        |
| Kubernetes       | Orchestrated clusters | High       |
| systemd          | Linux servers         | Low        |
| PM2              | Node.js apps          | Low        |
| AWS ECS          | AWS environment       | Medium     |
| Google Cloud Run | Serverless            | Low        |

### Deployment Checklist

- [ ] Choose authentication method (Service Account or OAuth)
- [ ] Generate and secure credentials
- [ ] Configure environment variables
- [ ] Set up logging and monitoring
- [ ] Configure rate limits for your quota
- [ ] Enable health checks
- [ ] Set up backups for token store
- [ ] Configure alerts
- [ ] Test in staging environment
- [ ] Document rollback procedure

---

## Docker Deployment

### Dockerfile

```dockerfile
# Dockerfile
FROM node:20-alpine

# Install dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY dist/ ./dist/
COPY SECURITY.md README.md ./

# Create non-root user
RUN addgroup -g 1001 servalsheets && \
    adduser -D -u 1001 -G servalsheets servalsheets && \
    chown -R servalsheets:servalsheets /app

# Switch to non-root user
USER servalsheets

# Expose ports
EXPOSE 3000 9090

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["node", "dist/cli.js"]
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  servalsheets:
    build: .
    image: servalsheets:1.0.0
    container_name: servalsheets
    restart: unless-stopped

    # Environment variables
    environment:
      NODE_ENV: production
      LOG_LEVEL: info
      LOG_FORMAT: json

      # Rate limiting
      SERVALSHEETS_READS_PER_MINUTE: 300
      SERVALSHEETS_WRITES_PER_MINUTE: 60

      # Caching
      SERVALSHEETS_CACHE_METADATA_TTL: 600000
      SERVALSHEETS_CACHE_DATA_TTL: 120000

      # Effect limits
      SERVALSHEETS_MAX_CELLS: 100000
      SERVALSHEETS_MAX_SHEETS: 20

      # Authentication (choose one)
      # Option 1: Service Account
      GOOGLE_APPLICATION_CREDENTIALS: /run/secrets/service_account

      # Option 2: OAuth Token
      # GOOGLE_ACCESS_TOKEN: ${GOOGLE_ACCESS_TOKEN}

      # Token store encryption
      GOOGLE_TOKEN_STORE_PATH: /app/data/tokens.enc
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}

      # Optional: Redis for HA sessions + Streamable HTTP resumability
      # REDIS_URL: redis://redis:6379

    # Secrets (for service account)
    secrets:
      - service_account

    # Volumes
    volumes:
      - servalsheets-data:/app/data
      - servalsheets-logs:/app/logs

    # Ports
    ports:
      - '3000:3000' # HTTP server
      - '9090:9090' # Metrics

    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M

    # Health check
    healthcheck:
      test:
        ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:3000/health/ready']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

    # Logging
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'

# Secrets
secrets:
  service_account:
    file: ~/.config/google/servalsheets-prod.json

# Volumes
volumes:
  servalsheets-data:
  servalsheets-logs:

# Networks
networks:
  default:
    name: servalsheets-network
```

### Build and Run

```bash
# Build image
docker build -t servalsheets:1.0.0 .

# Run with docker-compose
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f servalsheets

# Stop
docker-compose down
```

### Docker Secrets

```bash
# Create secrets
echo "ya29.xxx" | docker secret create google_access_token -

# Or for service account
docker secret create service_account ~/.config/google/servalsheets-prod.json

# Use in docker-compose.yml
services:
  servalsheets:
    secrets:
      - google_access_token
    environment:
      GOOGLE_ACCESS_TOKEN_FILE: /run/secrets/google_access_token
```

---

## Kubernetes Deployment

### Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: servalsheets
  labels:
    name: servalsheets
```

### ConfigMap

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: servalsheets-config
  namespace: servalsheets
data:
  NODE_ENV: 'production'
  LOG_LEVEL: 'info'
  LOG_FORMAT: 'json'
  SERVALSHEETS_READS_PER_MINUTE: '300'
  SERVALSHEETS_WRITES_PER_MINUTE: '60'
  SERVALSHEETS_CACHE_METADATA_TTL: '600000'
  SERVALSHEETS_CACHE_DATA_TTL: '120000'
  SERVALSHEETS_MAX_CELLS: '100000'
  SERVALSHEETS_MAX_SHEETS: '20'
```

### Secret

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: servalsheets-secret
  namespace: servalsheets
type: Opaque
stringData:
  # Service account JSON (base64 encoded)
  service-account.json: |
    {
      "type": "service_account",
      "project_id": "your-project",
      "private_key_id": "xxx",
      "private_key": "<service-account-private-key>",
      "client_email": "servalsheets-prod@your-project.iam.gserviceaccount.com",
      "client_id": "xxx",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs"
    }

  # Token store encryption key
  token-store-key: '8f3b2c1a9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'
```

### Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: servalsheets
  namespace: servalsheets
  labels:
    app: servalsheets
spec:
  replicas: 3

  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0

  selector:
    matchLabels:
      app: servalsheets

  template:
    metadata:
      labels:
        app: servalsheets
      annotations:
        prometheus.io/scrape: 'true'
        prometheus.io/port: '9090'
        prometheus.io/path: '/metrics'

    spec:
      # Service account for pod
      serviceAccountName: servalsheets

      # Security context
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001

      containers:
        - name: servalsheets
          image: servalsheets:1.0.0
          imagePullPolicy: IfNotPresent

          # Ports
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
            - name: metrics
              containerPort: 9090
              protocol: TCP

          # Environment from ConfigMap
          envFrom:
            - configMapRef:
                name: servalsheets-config

          # Environment from Secret
          env:
            - name: GOOGLE_APPLICATION_CREDENTIALS
              value: /secrets/service-account.json
            - name: ENCRYPTION_KEY
              valueFrom:
                secretKeyRef:
                  name: servalsheets-secret
                  key: token-store-key

          # Volume mounts
          volumeMounts:
            - name: secrets
              mountPath: /secrets
              readOnly: true
            - name: data
              mountPath: /app/data

          # Resource limits
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '512Mi'
              cpu: '500m'

          # Probes
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3

          startupProbe:
            httpGet:
              path: /health/startup
              port: 3000
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 30

      # Volumes
      volumes:
        - name: secrets
          secret:
            secretName: servalsheets-secret
            items:
              - key: service-account.json
                path: service-account.json
        - name: data
          persistentVolumeClaim:
            claimName: servalsheets-data

      # Affinity (spread pods across nodes)
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values:
                        - servalsheets
                topologyKey: kubernetes.io/hostname
```

### Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: servalsheets
  namespace: servalsheets
  labels:
    app: servalsheets
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 3000
      protocol: TCP
    - name: metrics
      port: 9090
      targetPort: 9090
      protocol: TCP
  selector:
    app: servalsheets
```

### Ingress

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: servalsheets
  namespace: servalsheets
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - servalsheets.example.com
      secretName: servalsheets-tls
  rules:
    - host: servalsheets.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: servalsheets
                port:
                  number: 80
```

### PersistentVolumeClaim

```yaml
# pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: servalsheets-data
  namespace: servalsheets
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: standard
```

### HorizontalPodAutoscaler

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: servalsheets
  namespace: servalsheets
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: servalsheets
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
```

### Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Create configmap and secret
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml

# Create PVC
kubectl apply -f pvc.yaml

# Deploy application
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
kubectl apply -f hpa.yaml

# Check status
kubectl get all -n servalsheets

# View logs
kubectl logs -f -n servalsheets -l app=servalsheets

# Port forward for testing
kubectl port-forward -n servalsheets svc/servalsheets 3000:80
```

---

## systemd Service

### Service File

```ini
# /etc/systemd/system/servalsheets.service
[Unit]
Description=ServalSheets MCP Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=servalsheets
Group=servalsheets
WorkingDirectory=/opt/servalsheets

# Environment
Environment="NODE_ENV=production"
Environment="LOG_LEVEL=info"
Environment="LOG_FORMAT=json"
Environment="GOOGLE_APPLICATION_CREDENTIALS=/opt/servalsheets/config/service-account.json"
Environment="GOOGLE_TOKEN_STORE_PATH=/opt/servalsheets/data/tokens.enc"
EnvironmentFile=/opt/servalsheets/config/servalsheets.env

# Command
ExecStart=/usr/bin/node /opt/servalsheets/dist/cli.js

# Restart policy
Restart=always
RestartSec=10
StartLimitBurst=5
StartLimitInterval=60s

# Resource limits
MemoryLimit=512M
CPUQuota=100%

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/servalsheets/data /opt/servalsheets/logs

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=servalsheets

[Install]
WantedBy=multi-user.target
```

### Environment File

```bash
# /opt/servalsheets/config/servalsheets.env
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=json

# Rate limiting
SERVALSHEETS_READS_PER_MINUTE=300
SERVALSHEETS_WRITES_PER_MINUTE=60

# Caching
SERVALSHEETS_CACHE_METADATA_TTL=600000
SERVALSHEETS_CACHE_DATA_TTL=120000

# Effect limits
SERVALSHEETS_MAX_CELLS=100000
SERVALSHEETS_MAX_SHEETS=20

# Authentication
GOOGLE_APPLICATION_CREDENTIALS=/opt/servalsheets/config/service-account.json

# Token store
GOOGLE_TOKEN_STORE_PATH=/opt/servalsheets/data/tokens.enc
ENCRYPTION_KEY=8f3b2c1a9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1

# Feature flags (staged rollout)
ENABLE_DATAFILTER_BATCH=true
ENABLE_TABLE_APPENDS=true
ENABLE_PAYLOAD_VALIDATION=true
ENABLE_LEGACY_SSE=true
```

### Feature Flag Rollout (Production)

Recommended staged rollout for new data paths:

1. **Deploy with flags enabled only in staging**
2. **Canary (5–10%)**: enable in a single instance or subset of tenants
3. **Ramp (25–50%)**: monitor error rate, latency p95, quota usage
4. **Full rollout (100%)** once metrics are stable for 24–48h

Key metrics to monitor:

- `sheets_data.batch_*` error rates
- Payload warning counts (`PAYLOAD_TOO_LARGE`, warning logs)
- Append/write latency p95/p99
- Quota limit hits (429s)

Rollback:

- Disable flags in environment and restart service
- Revert to range-based operations (no DataFilters, no tableId appends)

### Installation

```bash
# Create user
sudo useradd -r -s /bin/false servalsheets

# Create directories
sudo mkdir -p /opt/servalsheets/{config,data,logs}
sudo chown -R servalsheets:servalsheets /opt/servalsheets

# Copy files
sudo cp -r dist /opt/servalsheets/
sudo cp service-account.json /opt/servalsheets/config/
sudo cp servalsheets.env /opt/servalsheets/config/

# Set permissions
sudo chmod 600 /opt/servalsheets/config/service-account.json
sudo chmod 600 /opt/servalsheets/config/servalsheets.env
sudo chmod 700 /opt/servalsheets/data

# Install service
sudo cp servalsheets.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable servalsheets
sudo systemctl start servalsheets

# Check status
sudo systemctl status servalsheets

# View logs
sudo journalctl -u servalsheets -f
```

---

## PM2 Process Manager

### Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'servalsheets',
      script: './dist/cli.js',

      // Instances
      instances: 4,
      exec_mode: 'cluster',

      // Environment
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',

        // Rate limiting
        SERVALSHEETS_READS_PER_MINUTE: 300,
        SERVALSHEETS_WRITES_PER_MINUTE: 60,

        // Caching
        SERVALSHEETS_CACHE_METADATA_TTL: 600000,
        SERVALSHEETS_CACHE_DATA_TTL: 120000,

        // Effect limits
        SERVALSHEETS_MAX_CELLS: 100000,
        SERVALSHEETS_MAX_SHEETS: 20,

        // Authentication
        GOOGLE_APPLICATION_CREDENTIALS: '/path/to/service-account.json',

        // Token store
        GOOGLE_TOKEN_STORE_PATH: '/path/to/tokens.enc',
        ENCRYPTION_KEY: '8f3b2c1a9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1',
      },

      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      // Resource limits
      max_memory_restart: '500M',

      // Watch (development only)
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'data'],

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 3000,
    },
  ],

  // Deployment
  deploy: {
    production: {
      user: 'deploy',
      host: 'servalsheets.example.com',
      ref: 'origin/main',
      repo: 'git@github.com:user/servalsheets.git',
      path: '/opt/servalsheets',
      'post-deploy':
        'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
    },
  },
};
```

### PM2 Commands

```bash
# Start
pm2 start ecosystem.config.js

# Status
pm2 status

# Logs
pm2 logs servalsheets

# Monitor
pm2 monit

# Reload (zero-downtime)
pm2 reload servalsheets

# Restart
pm2 restart servalsheets

# Stop
pm2 stop servalsheets

# Delete
pm2 delete servalsheets

# Save configuration
pm2 save

# Startup script (auto-start on reboot)
pm2 startup
```

### PM2 Monitoring

```bash
# Install PM2 Plus
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# Link to PM2 Plus (cloud monitoring)
pm2 link <secret> <public>
```

---

## Cloud Platforms

### AWS ECS

```json
{
  "family": "servalsheets",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/servalsheets-task-role",
  "containerDefinitions": [
    {
      "name": "servalsheets",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/servalsheets:1.0.0",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "LOG_LEVEL", "value": "info" },
        { "name": "SERVALSHEETS_READS_PER_MINUTE", "value": "300" }
      ],
      "secrets": [
        {
          "name": "GOOGLE_APPLICATION_CREDENTIALS",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:servalsheets/service-account"
        },
        {
          "name": "ENCRYPTION_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:servalsheets/token-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/servalsheets",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "wget --quiet --tries=1 --spider http://localhost:3000/health/ready || exit 1"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 10
      }
    }
  ]
}
```

### Google Cloud Run

```yaml
# cloud-run.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: servalsheets
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: '1'
        autoscaling.knative.dev/maxScale: '10'
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      serviceAccountName: servalsheets@project-id.iam.gserviceaccount.com

      containers:
        - image: gcr.io/project-id/servalsheets:1.0.0
          ports:
            - containerPort: 3000

          env:
            - name: NODE_ENV
              value: production
            - name: LOG_LEVEL
              value: info
            - name: SERVALSHEETS_READS_PER_MINUTE
              value: '300'
            - name: GOOGLE_APPLICATION_CREDENTIALS
              value: /secrets/service-account.json

          volumeMounts:
            - name: service-account
              mountPath: /secrets
              readOnly: true

          resources:
            limits:
              memory: 512Mi
              cpu: '1000m'

          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000

          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000

      volumes:
        - name: service-account
          secret:
            secretName: servalsheets-service-account
```

### Deploy to Cloud Run

```bash
# Build and push image
gcloud builds submit --tag gcr.io/project-id/servalsheets:1.0.0

# Deploy
gcloud run deploy servalsheets \
  --image gcr.io/project-id/servalsheets:1.0.0 \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account servalsheets@project-id.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production,LOG_LEVEL=info \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300
```

---

## Load Balancing

### NGINX Load Balancer

```nginx
# /etc/nginx/conf.d/servalsheets.conf
upstream servalsheets {
    least_conn;

    server 10.0.1.10:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:3000 max_fails=3 fail_timeout=30s;

    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name servalsheets.example.com;

    # SSL
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.3;
    ssl_ciphers 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256';
    ssl_prefer_server_ciphers off;

    # Logging
    access_log /var/log/nginx/servalsheets.access.log;
    error_log /var/log/nginx/servalsheets.error.log;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Health check endpoint (no auth)
    location /health {
        proxy_pass http://servalsheets;
        access_log off;
    }

    # Main application
    location / {
        proxy_pass http://servalsheets;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;

        # Buffering
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
    }

    # Metrics endpoint (restricted)
    location /metrics {
        allow 10.0.0.0/8;
        deny all;

        proxy_pass http://servalsheets:9090;
    }
}
```

---

## Disaster Recovery

### Backup Strategy

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR=/backup/servalsheets
DATE=$(date +%Y%m%d_%H%M%S)

# Backup token store
cp /opt/servalsheets/data/tokens.enc $BACKUP_DIR/tokens-$DATE.enc

# Backup configuration
cp /opt/servalsheets/config/servalsheets.env $BACKUP_DIR/config-$DATE.env
cp /opt/servalsheets/config/service-account.json $BACKUP_DIR/sa-$DATE.json

# Encrypt backups
gpg --encrypt --recipient admin@example.com $BACKUP_DIR/tokens-$DATE.enc
gpg --encrypt --recipient admin@example.com $BACKUP_DIR/sa-$DATE.json

# Upload to S3
aws s3 sync $BACKUP_DIR s3://servalsheets-backups/

# Retention (keep 30 days)
find $BACKUP_DIR -type f -mtime +30 -delete
```

### Restore Procedure

```bash
#!/bin/bash
# restore.sh

BACKUP_DATE=$1

# Download from S3
aws s3 cp s3://servalsheets-backups/tokens-$BACKUP_DATE.enc.gpg /tmp/

# Decrypt
gpg --decrypt /tmp/tokens-$BACKUP_DATE.enc.gpg > /opt/servalsheets/data/tokens.enc

# Set permissions
chmod 600 /opt/servalsheets/data/tokens.enc
chown servalsheets:servalsheets /opt/servalsheets/data/tokens.enc

# Restart service
systemctl restart servalsheets
```

### Rollback Procedure

```bash
# Kubernetes rollback
kubectl rollout undo deployment/servalsheets -n servalsheets

# Docker rollback
docker-compose down
docker-compose up -d servalsheets:3.9.0

# systemd rollback
sudo systemctl stop servalsheets
sudo cp -r /opt/servalsheets.backup /opt/servalsheets
sudo systemctl start servalsheets
```

---

## Summary

ServalSheets supports multiple deployment methods:

| Method     | Best For           | Pros                    | Cons            |
| ---------- | ------------------ | ----------------------- | --------------- |
| Docker     | Containerized apps | Simple, portable        | Requires Docker |
| Kubernetes | Large-scale        | Auto-scaling, resilient | Complex setup   |
| systemd    | Linux servers      | Native, efficient       | Linux only      |
| PM2        | Node.js apps       | Easy, monitoring        | Single server   |
| Cloud Run  | Serverless         | Auto-scaling, cheap     | Cold starts     |

**Key Takeaway**: Choose deployment method based on your infrastructure, scale requirements, and operational expertise.

For security best practices, see `SECURITY.md`.
For monitoring, see `MONITORING.md`.
For troubleshooting, see `TROUBLESHOOTING.md`.
