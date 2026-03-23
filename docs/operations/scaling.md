---
title: Scaling Guide
category: runbook
last_updated: 2026-01-31
description: ServalSheets scaling strategies for handling increased load. Covers vertical scaling (bigger instances) and horizontal scaling (more instances).
version: 1.6.0
tags: [sheets, docker, kubernetes]
estimated_time: 15-30 minutes
---

# Scaling Guide

## Overview

ServalSheets scaling strategies for handling increased load. Covers vertical scaling (bigger instances) and horizontal scaling (more instances).

---

## When to Scale

### Indicators

**Scale UP when:**

- CPU usage consistently > 70%
- Memory usage consistently > 80%
- Request latency > 1 second (p95)
- Queue depth increasing
- Error rate increasing

**Scale DOWN when:**

- CPU usage consistently < 20%
- Memory usage consistently < 40%
- Cost optimization needed
- Over-provisioned resources

### Monitoring Metrics

```yaml
# Key metrics to watch
- request_rate
- request_duration_p95
- error_rate
- cpu_usage_percent
- memory_usage_percent
- redis_connections
- google_api_quota_remaining
```

---

## Vertical Scaling

### Advantages

✅ Simple - no architecture changes
✅ Lower latency - no network hops
✅ Easier to debug
✅ State remains in-memory

### Disadvantages

❌ Limited by hardware
❌ Downtime during scaling
❌ Single point of failure
❌ More expensive

### Procedure

#### Docker Compose

```yaml
# docker-compose.yml
services:
  servalsheets:
    image: servalsheets:latest
    deploy:
      resources:
        limits:
          cpus: '4.0' # Increase from 2.0
          memory: 8G # Increase from 4G
        reservations:
          cpus: '2.0'
          memory: 4G
```

```bash
# Apply changes
docker-compose up -d
```

#### Kubernetes

```yaml
# k8s/deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: servalsheets
          resources:
            requests:
              memory: '4Gi' # Increase from 2Gi
              cpu: '2000m' # Increase from 1000m
            limits:
              memory: '8Gi' # Increase from 4Gi
              cpu: '4000m' # Increase from 2000m
```

```bash
# Apply and rolling update
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/servalsheets
```

#### Cloud VMs

```bash
# AWS - resize EC2 instance
aws ec2 stop-instances --instance-ids i-1234567890abcdef0
aws ec2 modify-instance-attribute \
  --instance-id i-1234567890abcdef0 \
  --instance-type t3.xlarge  # Up from t3.large

aws ec2 start-instances --instance-ids i-1234567890abcdef0

# GCP - resize Compute Engine
gcloud compute instances stop servalsheets-1
gcloud compute instances set-machine-type servalsheets-1 \
  --machine-type n1-standard-4  # Up from n1-standard-2
gcloud compute instances start servalsheets-1
```

---

## Horizontal Scaling

### Advantages

✅ Better availability (no single point of failure)
✅ Zero-downtime scaling
✅ Cost-effective for high scale
✅ Geographic distribution possible

### Disadvantages

❌ Requires Redis for shared state
❌ More complex architecture
❌ Load balancer needed
❌ Harder to debug

### Prerequisites

**CRITICAL**: Set up Redis for shared state

```bash
# 1. Set REDIS_URL in environment
export REDIS_URL=redis://your-redis-host:6379

# 2. Verify Redis connection
redis-cli -u $REDIS_URL PING
# Expected: PONG

# 3. Server automatically uses Redis for:
#    - OAuth sessions
#    - Task state
#    - Rate limiting state (if using Redis limiter)
```

Without Redis, each instance has isolated state = broken experience!

---

### Load Balancer Setup

#### nginx

```nginx
# /etc/nginx/conf.d/servalsheets.conf
upstream servalsheets {
    least_conn;  # Route to instance with fewest connections

    # Health checks
    server app1.internal:3000 max_fails=3 fail_timeout=30s;
    server app2.internal:3000 max_fails=3 fail_timeout=30s;
    server app3.internal:3000 max_fails=3 fail_timeout=30s;

    keepalive 32;  # Connection pooling
}

server {
    listen 443 ssl http2;
    server_name servalsheets.example.com;

    # SSL configuration
    ssl_certificate /etc/ssl/certs/servalsheets.crt;
    ssl_certificate_key /etc/ssl/private/servalsheets.key;

    # Proxy settings
    location / {
        proxy_pass http://servalsheets;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 300s;  # 5 min for long-running operations
    }

    # Health check endpoint (doesn't count toward rate limit)
    location /health {
        proxy_pass http://servalsheets;
        access_log off;
    }
}
```

#### Kubernetes Service + Ingress

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: servalsheets
spec:
  selector:
    app: servalsheets
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
  sessionAffinity: None # No sticky sessions needed (Redis handles state)

---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: servalsheets
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: '10m'
    nginx.ingress.kubernetes.io/proxy-connect-timeout: '60'
    nginx.ingress.kubernetes.io/proxy-send-timeout: '60'
    nginx.ingress.kubernetes.io/proxy-read-timeout: '300'
spec:
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

#### AWS Application Load Balancer

```bash
# Create target group
aws elbv2 create-target-group \
  --name servalsheets-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxx \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3

# Register targets
aws elbv2 register-targets \
  --target-group-arn arn:aws:elasticloadbalancing:... \
  --targets Id=i-instance1 Id=i-instance2 Id=i-instance3

# Create load balancer
aws elbv2 create-load-balancer \
  --name servalsheets-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx \
  --scheme internet-facing \
  --type application
```

---

### Scaling Procedures

#### Manual Scaling

**Docker Compose:**

```bash
# Scale to 3 instances
docker-compose up -d --scale servalsheets=3

# Verify
docker-compose ps
```

**Kubernetes:**

```bash
# Scale to 5 replicas
kubectl scale deployment servalsheets --replicas=5

# Verify
kubectl get pods -l app=servalsheets
```

**AWS Auto Scaling Group:**

```bash
# Update desired capacity
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name servalsheets-asg \
  --desired-capacity 5

# Verify
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names servalsheets-asg
```

---

#### Auto Scaling

**Kubernetes HorizontalPodAutoscaler:**

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: servalsheets-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: servalsheets
  minReplicas: 3
  maxReplicas: 20
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
      stabilizationWindowSeconds: 300 # Wait 5 min before scaling down
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60 # Max 50% scale down per minute
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60 # Max 100% scale up per minute
```

```bash
# Apply HPA
kubectl apply -f k8s/hpa.yaml

# Monitor autoscaling
watch kubectl get hpa servalsheets-hpa
```

**AWS Auto Scaling Policy:**

```bash
# Create scaling policy for CPU
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name servalsheets-asg \
  --policy-name scale-up-cpu \
  --policy-type=TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 70.0
  }'

# Create scaling policy for ALB requests
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name servalsheets-asg \
  --policy-name scale-up-requests \
  --policy-type=TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ALBRequestCountPerTarget",
      "ResourceLabel": "app/servalsheets-alb/.../targetgroup/servalsheets-tg/..."
    },
    "TargetValue": 1000.0
  }'
```

---

## Redis Scaling

### Vertical Scaling (More Memory)

```bash
# Redis Cloud
# Go to console → Select database → Edit → Increase memory

# Self-hosted
# 1. Update Redis configuration
redis-cli CONFIG SET maxmemory 8gb

# 2. Make permanent in redis.conf
echo "maxmemory 8gb" >> /etc/redis/redis.conf

# 3. Restart Redis
systemctl restart redis
```

### Redis Cluster (Horizontal Scaling)

For very high scale (>100k sessions):

```yaml
# docker-compose.yml - Redis Cluster
services:
  redis-1:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-node-timeout 5000
  redis-2:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-node-timeout 5000
  redis-3:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-node-timeout 5000
```

```bash
# Initialize cluster
redis-cli --cluster create \
  redis-1:6379 redis-2:6379 redis-3:6379 \
  --cluster-replicas 0
```

**Update application:**

```bash
# Use Redis Cluster connection string
export REDIS_URL="redis://redis-1:6379,redis-2:6379,redis-3:6379"
```

---

## Google Sheets API Quota Scaling

### Default Quotas

- Read requests: 300/min per user
- Write requests: 60/min per user

### Quota Increase Request

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/api/sheets.googleapis.com/quotas)
2. Click "Edit Quotas"
3. Request increase (typically approved within 24-48 hours)

### Recommended Quotas for Scale

| Load Level               | Read/min | Write/min |
| ------------------------ | -------- | --------- |
| Small (1-10 users)       | 300      | 60        |
| Medium (10-100 users)    | 3,000    | 600       |
| Large (100-1000 users)   | 30,000   | 6,000     |
| Enterprise (1000+ users) | 300,000  | 60,000    |

### Quota Monitoring

```typescript
// Already built-in: RateLimiter tracks quota usage
// Check metrics:
// - sheets_api_requests_total
// - sheets_api_quota_remaining
```

---

## Capacity Planning

### Baseline Metrics

**Single instance capacity** (default t3.medium / 2 CPU / 4GB RAM):

- Concurrent users: ~50
- Requests/second: ~100
- Active sessions: ~500

### Scaling Calculations

```
Required Instances = ceil(Expected Users / Users per Instance)

Example:
- Expected: 500 concurrent users
- Capacity: 50 users per instance
- Required: ceil(500 / 50) = 10 instances

Add 20% buffer: 10 * 1.2 = 12 instances
```

### Load Testing

```bash
# Install k6
brew install k6

# Run load test
k6 run tests/load/servalsheets-load-test.js

# With custom VUs (virtual users)
k6 run --vus 100 --duration 5m tests/load/servalsheets-load-test.js
```

Example load test script:

```javascript
// tests/load/servalsheets-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 50 }, // Ramp up to 50 users
    { duration: '5m', target: 50 }, // Stay at 50 users
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% under 1s
    http_req_failed: ['rate<0.01'], // Error rate < 1%
  },
};

export default function () {
  const res = http.get('https://servalsheets.example.com/health');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 1s': (r) => r.timings.duration < 1000,
  });

  sleep(1);
}
```

---

## Cost Optimization

### Right-Sizing

```bash
# Monitor actual resource usage
kubectl top pods -n servalsheets
# or: docker stats

# If consistently under-utilized, scale down:
# CPU < 20% → Reduce CPU allocation by 50%
# Memory < 40% → Reduce memory allocation by 30%
```

### Spot/Preemptible Instances

**AWS Spot Instances** (up to 90% cheaper):

```yaml
# k8s/spot-deployment.yaml
spec:
  template:
    spec:
      nodeSelector:
        node.kubernetes.io/instance-type: spot
      tolerations:
        - key: 'spot'
          operator: 'Equal'
          value: 'true'
          effect: 'NoSchedule'
```

**GCP Preemptible VMs** (up to 80% cheaper):

```yaml
spec:
  template:
    spec:
      nodeSelector:
        cloud.google.com/gke-preemptible: 'true'
```

⚠️ **Warning**: Spot instances can be terminated with 30 seconds notice. Always run:

- Minimum 3 instances
- Mix of spot and on-demand
- Graceful shutdown handling

---

## Checklist

### Before Scaling

- [ ] Redis configured and tested
- [ ] Load balancer set up
- [ ] Health checks working
- [ ] Monitoring in place
- [ ] Backups verified
- [ ] Test in staging first

### After Scaling

- [ ] Verify all instances healthy
- [ ] Check load distribution
- [ ] Monitor for errors
- [ ] Test OAuth flow
- [ ] Verify session persistence
- [ ] Update documentation

---

## Troubleshooting

**Problem**: New instances not receiving traffic

**Solution**:

```bash
# Check load balancer health checks
curl http://instance-ip:3000/health

# Check instance can reach Redis
redis-cli -h redis-host PING

# Check load balancer configuration
nginx -t
# or: kubectl describe ingress servalsheets
```

**Problem**: Sessions not shared across instances

**Solution**:

```bash
# Verify REDIS_URL is set on all instances
echo $REDIS_URL

# Test Redis connectivity from each instance
redis-cli -u $REDIS_URL PING

# Check session in Redis
redis-cli KEYS "servalsheets:session:*"
```

**Problem**: Uneven load distribution

**Solution**:

- Use `least_conn` instead of `round_robin` in nginx
- Check if some instances are slower (resource constrained)
- Verify health checks are working properly

---

## Summary

✅ **Vertical Scaling**: Simple, good for <100 concurrent users
✅ **Horizontal Scaling**: Better availability, required for >100 users
✅ **Redis Required**: For horizontal scaling to work
✅ **Load Balancer**: Distributes traffic across instances
✅ **Auto-scaling**: Handles traffic spikes automatically
✅ **Monitor**: Watch metrics, adjust capacity as needed
