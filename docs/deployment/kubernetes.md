---
title: Kubernetes Deployment
category: general
last_updated: 2026-02-17
description: Deploy ServalSheets on Kubernetes using the operator or manual manifests for production-grade scalability.
version: 1.6.0
tags: [deployment, kubernetes, operator, crd, autoscaling, prometheus]
---

# Kubernetes Deployment

Deploy ServalSheets on Kubernetes for production-grade scalability and reliability. This guide covers two deployment approaches:

1. **Kubernetes Operator** (Recommended) - Declarative, automated management with custom resources
2. **Manual Manifests** - Traditional Kubernetes deployment with manual configuration

## Table of Contents

- [Operator Deployment (Recommended)](#operator-deployment-recommended)
  - [Architecture Overview](#architecture-overview)
  - [Prerequisites](#prerequisites-operator)
  - [Installation](#installation)
  - [Creating ServalSheetsServer Resources](#creating-servalsheetsserver-resources)
  - [Configuration Reference](#configuration-reference)
  - [Auto-scaling](#auto-scaling)
  - [OAuth & Authentication](#oauth--authentication)
  - [Ingress & TLS](#ingress--tls)
  - [Monitoring & Operations](#monitoring--operations)
- [Manual Deployment](#manual-deployment)
- [Examples](#examples)
- [RBAC Reference](#rbac-reference)
- [Troubleshooting](#troubleshooting)

---

## Operator Deployment (Recommended)

The ServalSheets Kubernetes Operator provides declarative management of MCP servers through a custom resource definition (CRD). It automates deployment, scaling, configuration, and lifecycle management.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Kubernetes Cluster                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         servalsheets-system namespace                 │  │
│  │                                                        │  │
│  │  ┌─────────────────────────────────────┐             │  │
│  │  │   ServalSheets Operator             │             │  │
│  │  │   (watches ServalSheetsServer CRs)  │             │  │
│  │  └─────────────┬───────────────────────┘             │  │
│  │                │ reconciles                           │  │
│  └────────────────┼──────────────────────────────────────┘  │
│                   │                                          │
│  ┌────────────────▼──────────────────────────────────────┐  │
│  │         User namespaces (default, prod, etc.)         │  │
│  │                                                        │  │
│  │  ServalSheetsServer CR                                │  │
│  │    ↓ creates                                          │  │
│  │  ┌──────────────────────────────────────────┐        │  │
│  │  │ Deployment (with replicas & resources)   │        │  │
│  │  │   ├─ Pod 1 (MCP server)                  │        │  │
│  │  │   ├─ Pod 2 (MCP server)                  │        │  │
│  │  │   └─ Pod N (MCP server)                  │        │  │
│  │  └──────────────────────────────────────────┘        │  │
│  │  ┌──────────────────────────────────────────┐        │  │
│  │  │ Service (load balancer)                  │        │  │
│  │  └──────────────────────────────────────────┘        │  │
│  │  ┌──────────────────────────────────────────┐        │  │
│  │  │ HorizontalPodAutoscaler (optional)       │        │  │
│  │  └──────────────────────────────────────────┘        │  │
│  │  ┌──────────────────────────────────────────┐        │  │
│  │  │ Ingress (optional)                       │        │  │
│  │  └──────────────────────────────────────────┘        │  │
│  │  ┌──────────────────────────────────────────┐        │  │
│  │  │ ConfigMap (server configuration)         │        │  │
│  │  └──────────────────────────────────────────┘        │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Key Components:**

- **CRD**: `ServalSheetsServer` custom resource (API: `servalsheets.io/v1alpha1`)
- **Operator**: Watches CRs and reconciles Kubernetes resources
- **Managed Resources**: Deployments, Services, HPAs, Ingresses, ConfigMaps, Secrets

### Prerequisites (Operator)

- **Kubernetes**: 1.28+ (tested on 1.28, 1.29, 1.30)
- **kubectl**: Configured with cluster access
- **Cluster Permissions**: Cluster admin or ability to create CRDs, ClusterRoles, ClusterRoleBindings
- **Optional**:
  - Ingress controller (nginx, traefik, etc.) for external access
  - cert-manager for TLS certificate management
  - Redis for caching (recommended for production)
  - Prometheus for metrics (recommended for production)

### Installation

#### Quick Start

```bash
# 1. Install the operator (CRDs + RBAC + Operator deployment)
kubectl apply -f https://raw.githubusercontent.com/yourusername/servalsheets/main/k8s/install.yaml

# 2. Wait for operator to be ready
kubectl wait --for=condition=ready pod \
  -l app=servalsheets-operator \
  -n servalsheets-system \
  --timeout=60s

# 3. Create a ServalSheetsServer in your namespace
kubectl apply -f - <<EOF
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: my-sheets-server
  namespace: default
spec:
  replicas: 2
  image:
    repository: servalsheets/server
    tag: "1.6.0"
  resources:
    requests:
      cpu: "200m"
      memory: "256Mi"
    limits:
      cpu: "1000m"
      memory: "512Mi"
EOF

# 4. Check status
kubectl get servalsheets-servers
kubectl describe servalsheets-server my-sheets-server
```

#### Manual Installation

**Step 1: Install CRD**

```bash
kubectl apply -f k8s/crds/servalsheets-server.yaml
```

**Step 2: Install RBAC**

```bash
# Creates: Namespace, ServiceAccount, ClusterRole, ClusterRoleBinding
kubectl apply -f k8s/operator/rbac.yaml
```

**Step 3: Deploy Operator**

```bash
kubectl apply -f k8s/operator/deployment.yaml

# Verify operator is running
kubectl get pods -n servalsheets-system
```

**Step 4: Create Secrets (if using OAuth or Google credentials)**

```bash
# Google service account credentials
kubectl create secret generic google-credentials \
  --namespace default \
  --from-file=credentials.json=/path/to/service-account.json

# OAuth client credentials (if using OAuth)
kubectl create secret generic oauth-client-secret \
  --namespace default \
  --from-literal=clientSecret=YOUR_OAUTH_CLIENT_SECRET
```

#### Helm Installation (Alternative)

```bash
# Add Helm repository
helm repo add servalsheets https://servalsheets.io/helm
helm repo update

# Install operator
helm install servalsheets-operator servalsheets/operator \
  --namespace servalsheets-system \
  --create-namespace

# Create a server instance
helm install my-sheets-server servalsheets/servalsheets-server \
  --namespace default \
  --set replicas=2 \
  --set autoscaling.enabled=true
```

### Creating ServalSheetsServer Resources

A `ServalSheetsServer` is a custom resource that represents a deployed MCP server instance. The operator watches these resources and manages the underlying Kubernetes objects.

#### Basic Example

```yaml
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: dev-server
  namespace: development
spec:
  replicas: 1
  image:
    repository: servalsheets/server
    tag: '1.6.0'
    pullPolicy: IfNotPresent
```

#### Production Example

```yaml
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: prod-server
  namespace: production
spec:
  replicas: 3
  image:
    repository: servalsheets/server
    tag: '1.6.0'
    pullPolicy: IfNotPresent

  resources:
    requests:
      cpu: '500m'
      memory: '512Mi'
    limits:
      cpu: '2000m'
      memory: '2Gi'

  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80
    targetRequestRatePerSecond: 150

  config:
    redis:
      enabled: true
      host: redis-service.production.svc.cluster.local
      port: 6379
      passwordSecretRef:
        name: redis-password
        key: password

    observability:
      metricsEnabled: true
      metricsPort: 9090
      tracingEnabled: true
      tracingEndpoint: 'http://jaeger-collector:14268/api/traces'

    google:
      credentialsSecretRef:
        name: google-credentials
        key: credentials.json

  ingress:
    enabled: true
    className: nginx
    host: sheets.prod.example.com
    tls:
      enabled: true
      secretName: prod-tls-cert
    annotations:
      cert-manager.io/cluster-issuer: 'letsencrypt-prod'
      nginx.ingress.kubernetes.io/rate-limit: '100'
```

### Configuration Reference

#### Spec Fields

| Field                                           | Type    | Required | Default               | Description                                           |
| ----------------------------------------------- | ------- | -------- | --------------------- | ----------------------------------------------------- |
| `replicas`                                      | integer | **Yes**  | 1                     | Number of pod replicas (1-100)                        |
| `image.repository`                              | string  | No       | `servalsheets/server` | Container image repository                            |
| `image.tag`                                     | string  | No       | `latest`              | Container image tag                                   |
| `image.pullPolicy`                              | string  | No       | `IfNotPresent`        | Image pull policy (`Always`, `IfNotPresent`, `Never`) |
| `resources.requests.cpu`                        | string  | No       | `100m`                | CPU request                                           |
| `resources.requests.memory`                     | string  | No       | `128Mi`               | Memory request                                        |
| `resources.limits.cpu`                          | string  | No       | `1000m`               | CPU limit                                             |
| `resources.limits.memory`                       | string  | No       | `512Mi`               | Memory limit                                          |
| `autoscaling.enabled`                           | boolean | No       | `true`                | Enable HorizontalPodAutoscaler                        |
| `autoscaling.minReplicas`                       | integer | No       | 1                     | Minimum replicas for HPA                              |
| `autoscaling.maxReplicas`                       | integer | No       | 10                    | Maximum replicas for HPA                              |
| `autoscaling.targetCPUUtilizationPercentage`    | integer | No       | 70                    | Target CPU utilization (1-100)                        |
| `autoscaling.targetMemoryUtilizationPercentage` | integer | No       | 80                    | Target memory utilization (1-100)                     |
| `autoscaling.targetRequestRatePerSecond`        | integer | No       | 100                   | Target requests/sec per pod                           |
| `config.oauth.enabled`                          | boolean | No       | `false`               | Enable OAuth 2.1 authentication                       |
| `config.oauth.issuer`                           | string  | No       | -                     | OAuth issuer URL                                      |
| `config.oauth.clientId`                         | string  | No       | -                     | OAuth client ID                                       |
| `config.oauth.clientSecretRef.name`             | string  | No       | -                     | Secret name containing OAuth client secret            |
| `config.oauth.clientSecretRef.key`              | string  | No       | -                     | Secret key containing OAuth client secret             |
| `config.google.credentialsSecretRef.name`       | string  | No       | -                     | Secret name containing Google credentials JSON        |
| `config.google.credentialsSecretRef.key`        | string  | No       | -                     | Secret key containing Google credentials JSON         |
| `config.redis.enabled`                          | boolean | No       | `false`               | Enable Redis caching                                  |
| `config.redis.host`                             | string  | No       | -                     | Redis host (e.g., `redis-service`)                    |
| `config.redis.port`                             | integer | No       | 6379                  | Redis port                                            |
| `config.redis.passwordSecretRef.name`           | string  | No       | -                     | Secret name containing Redis password                 |
| `config.redis.passwordSecretRef.key`            | string  | No       | -                     | Secret key containing Redis password                  |
| `config.observability.metricsEnabled`           | boolean | No       | `true`                | Enable Prometheus metrics                             |
| `config.observability.metricsPort`              | integer | No       | 9090                  | Metrics port                                          |
| `config.observability.tracingEnabled`           | boolean | No       | `false`               | Enable distributed tracing                            |
| `config.observability.tracingEndpoint`          | string  | No       | -                     | Tracing endpoint URL                                  |
| `ingress.enabled`                               | boolean | No       | `false`               | Create Ingress resource                               |
| `ingress.className`                             | string  | No       | `nginx`               | Ingress class name                                    |
| `ingress.host`                                  | string  | No       | -                     | Ingress hostname                                      |
| `ingress.tls.enabled`                           | boolean | No       | `false`               | Enable TLS                                            |
| `ingress.tls.secretName`                        | string  | No       | -                     | TLS certificate secret name                           |
| `ingress.annotations`                           | object  | No       | `{}`                  | Custom ingress annotations                            |

#### Status Fields

The operator updates the `status` field with current state information:

| Field                              | Type      | Description                                                           |
| ---------------------------------- | --------- | --------------------------------------------------------------------- |
| `phase`                            | string    | Current phase: `Pending`, `Running`, `Failed`, `Scaling`              |
| `replicas`                         | integer   | Current number of replicas                                            |
| `readyReplicas`                    | integer   | Number of ready replicas                                              |
| `observedGeneration`               | integer   | Most recent generation observed by operator                           |
| `lastScaleTime`                    | timestamp | Last time autoscaler scaled the deployment                            |
| `currentMetrics.cpuUtilization`    | integer   | Current CPU utilization percentage                                    |
| `currentMetrics.memoryUtilization` | integer   | Current memory utilization percentage                                 |
| `currentMetrics.requestRate`       | integer   | Current requests per second                                           |
| `conditions[]`                     | array     | Status conditions (type, status, reason, message, lastTransitionTime) |

**Example status:**

```yaml
status:
  phase: Running
  replicas: 5
  readyReplicas: 5
  observedGeneration: 3
  lastScaleTime: '2026-02-17T10:30:00Z'
  currentMetrics:
    cpuUtilization: 68
    memoryUtilization: 72
    requestRate: 145
  conditions:
    - type: Available
      status: 'True'
      lastTransitionTime: '2026-02-17T09:00:00Z'
      reason: MinimumReplicasAvailable
      message: 'Deployment has minimum availability'
    - type: Progressing
      status: 'True'
      lastTransitionTime: '2026-02-17T10:30:00Z'
      reason: NewReplicaSetAvailable
      message: 'ReplicaSet has successfully progressed'
```

### Auto-scaling

The operator creates a HorizontalPodAutoscaler (HPA) when `autoscaling.enabled: true`. The HPA monitors metrics and scales pods automatically.

#### CPU & Memory-based Scaling

```yaml
spec:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70 # Scale up at 70% CPU
    targetMemoryUtilizationPercentage: 80 # Scale up at 80% memory
```

#### Request Rate Scaling (Custom Metric)

```yaml
spec:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 20
    targetRequestRatePerSecond: 100 # Scale to maintain 100 req/s per pod
```

**Prerequisites for request rate scaling:**

- Prometheus metrics server installed
- Prometheus adapter configured with custom metrics
- Application exposes `http_requests_per_second` metric

#### Verify Auto-scaling

```bash
# Check HPA status
kubectl get hpa -n your-namespace

# Watch HPA scale events
kubectl describe hpa servalsheets-prod -n production

# View current metrics
kubectl top pods -n production
```

### OAuth & Authentication

The operator supports OAuth 2.1 authentication for multi-tenant deployments.

#### Enable OAuth

```yaml
spec:
  config:
    oauth:
      enabled: true
      issuer: 'https://auth.example.com'
      clientId: 'servalsheets-prod'
      clientSecretRef:
        name: oauth-client-secret
        key: clientSecret
```

#### Create OAuth Secret

```bash
kubectl create secret generic oauth-client-secret \
  --namespace production \
  --from-literal=clientSecret=YOUR_SECRET_HERE
```

#### Google Credentials

For Google Sheets API access, provide service account credentials:

```yaml
spec:
  config:
    google:
      credentialsSecretRef:
        name: google-credentials
        key: credentials.json
```

```bash
# Create secret from service account JSON file
kubectl create secret generic google-credentials \
  --namespace production \
  --from-file=credentials.json=/path/to/service-account.json
```

### Ingress & TLS

The operator can automatically create an Ingress resource with TLS support.

#### Basic Ingress

```yaml
spec:
  ingress:
    enabled: true
    className: nginx
    host: sheets.example.com
```

#### Ingress with TLS

```yaml
spec:
  ingress:
    enabled: true
    className: nginx
    host: sheets.example.com
    tls:
      enabled: true
      secretName: sheets-tls-cert
    annotations:
      cert-manager.io/cluster-issuer: 'letsencrypt-prod'
      nginx.ingress.kubernetes.io/ssl-redirect: 'true'
      nginx.ingress.kubernetes.io/force-ssl-redirect: 'true'
```

**With cert-manager installed**, the annotation `cert-manager.io/cluster-issuer: "letsencrypt-prod"` will automatically provision a TLS certificate.

#### Manual TLS Certificate

```bash
# Create TLS secret manually
kubectl create secret tls sheets-tls-cert \
  --namespace production \
  --cert=/path/to/tls.crt \
  --key=/path/to/tls.key
```

### Monitoring & Operations

#### View Resources

```bash
# List all ServalSheetsServer resources (shortname: sss)
kubectl get sss --all-namespaces
kubectl get servalsheets-servers -n production

# Describe specific server (shows status, events, conditions)
kubectl describe sss prod-server -n production

# Get YAML output
kubectl get sss prod-server -n production -o yaml
```

#### Check Status

```bash
# Watch server status
kubectl get sss -n production -w

# Check phase and replicas
kubectl get sss -n production -o custom-columns=\
NAME:.metadata.name,\
PHASE:.status.phase,\
REPLICAS:.status.replicas,\
READY:.status.readyReplicas,\
AGE:.metadata.creationTimestamp
```

#### View Logs

```bash
# View operator logs
kubectl logs -n servalsheets-system -l app=servalsheets-operator -f

# View server pod logs
kubectl logs -n production -l app=servalsheets-prod-server -f

# View logs from specific pod
kubectl logs -n production prod-server-5d7f8c9b-xk2p4 -f
```

#### Update Server Configuration

```bash
# Edit live resource
kubectl edit sss prod-server -n production

# Apply updated YAML file
kubectl apply -f updated-server.yaml

# Patch specific field
kubectl patch sss prod-server -n production \
  --type merge \
  --patch '{"spec":{"replicas":5}}'
```

#### Scale Manually

```bash
# Scale using kubectl scale
kubectl scale sss prod-server -n production --replicas=5

# Scale using patch
kubectl patch sss prod-server -n production \
  --type merge \
  --patch '{"spec":{"replicas":5}}'
```

#### Delete Server

```bash
# Delete specific server (deletes all managed resources)
kubectl delete sss prod-server -n production

# Delete all servers in namespace
kubectl delete sss --all -n production
```

---

## Manual Deployment

For environments without the operator, use traditional Kubernetes manifests.

## Manifests

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: servalsheets
  namespace: servalsheets
spec:
  replicas: 2
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
        prometheus.io/port: '3000'
    spec:
      containers:
        - name: servalsheets
          image: servalsheets:1.6.0
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: 'production'
            - name: GOOGLE_APPLICATION_CREDENTIALS
              value: '/etc/google/service-account.json'
          volumeMounts:
            - name: google-credentials
              mountPath: /etc/google
              readOnly: true
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 2000m
              memory: 2Gi
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
      volumes:
        - name: google-credentials
          secret:
            secretName: google-credentials
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: servalsheets
  namespace: servalsheets
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 3000
  selector:
    app: servalsheets
```

### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: servalsheets
  namespace: servalsheets
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - sheets.example.com
      secretName: servalsheets-tls
  rules:
    - host: sheets.example.com
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

### HPA

```yaml
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
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Monitoring

```bash
# Check pods
kubectl get pods -n servalsheets

# View logs
kubectl logs -n servalsheets -l app=servalsheets -f

# Port forward for local testing
kubectl port-forward -n servalsheets svc/servalsheets 3000:80
```

---

## Examples

### Example 1: Development Environment

Simple single-replica setup for local development:

```yaml
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: dev-server
  namespace: development
spec:
  replicas: 1
  image:
    repository: servalsheets/server
    tag: 'latest'
    pullPolicy: Always
  resources:
    requests:
      cpu: '100m'
      memory: '128Mi'
    limits:
      cpu: '500m'
      memory: '256Mi'
  autoscaling:
    enabled: false
  config:
    observability:
      metricsEnabled: true
      metricsPort: 9090
```

### Example 2: Production High Availability

Multi-replica production deployment with auto-scaling, Redis caching, and monitoring:

```yaml
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: prod-ha-server
  namespace: production
spec:
  replicas: 5
  image:
    repository: servalsheets/server
    tag: '1.6.0'
    pullPolicy: IfNotPresent

  resources:
    requests:
      cpu: '1000m'
      memory: '1Gi'
    limits:
      cpu: '4000m'
      memory: '4Gi'

  autoscaling:
    enabled: true
    minReplicas: 5
    maxReplicas: 30
    targetCPUUtilizationPercentage: 65
    targetMemoryUtilizationPercentage: 75
    targetRequestRatePerSecond: 200

  config:
    redis:
      enabled: true
      host: redis-ha.production.svc.cluster.local
      port: 6379
      passwordSecretRef:
        name: redis-ha-password
        key: password

    observability:
      metricsEnabled: true
      metricsPort: 9090
      tracingEnabled: true
      tracingEndpoint: 'http://jaeger-collector.observability:14268/api/traces'

    google:
      credentialsSecretRef:
        name: google-prod-credentials
        key: credentials.json

    oauth:
      enabled: true
      issuer: 'https://auth.example.com'
      clientId: 'servalsheets-production'
      clientSecretRef:
        name: oauth-prod-secret
        key: clientSecret

  ingress:
    enabled: true
    className: nginx
    host: sheets.prod.example.com
    tls:
      enabled: true
      secretName: prod-wildcard-tls
    annotations:
      cert-manager.io/cluster-issuer: 'letsencrypt-prod'
      nginx.ingress.kubernetes.io/rate-limit: '500'
      nginx.ingress.kubernetes.io/proxy-body-size: '50m'
      nginx.ingress.kubernetes.io/proxy-connect-timeout: '60'
      nginx.ingress.kubernetes.io/proxy-send-timeout: '60'
      nginx.ingress.kubernetes.io/proxy-read-timeout: '60'
```

### Example 3: Multi-Region Deployment

Deploy identical servers across multiple regions with geo-routing:

```bash
# Region 1: US East
cat <<EOF | kubectl apply -f -
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: server-us-east
  namespace: prod-us-east
  labels:
    region: us-east
    environment: production
spec:
  replicas: 3
  image:
    repository: servalsheets/server
    tag: "1.6.0"
  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "2000m"
      memory: "2Gi"
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 15
  config:
    redis:
      enabled: true
      host: redis-us-east.prod-us-east.svc.cluster.local
    google:
      credentialsSecretRef:
        name: google-credentials-us-east
        key: credentials.json
  ingress:
    enabled: true
    host: sheets-us-east.example.com
    tls:
      enabled: true
      secretName: tls-us-east
EOF

# Region 2: EU West
cat <<EOF | kubectl apply -f -
apiVersion: servalsheets.io/v1alpha1
kind: ServalSheetsServer
metadata:
  name: server-eu-west
  namespace: prod-eu-west
  labels:
    region: eu-west
    environment: production
spec:
  replicas: 3
  image:
    repository: servalsheets/server
    tag: "1.6.0"
  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "2000m"
      memory: "2Gi"
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 15
  config:
    redis:
      enabled: true
      host: redis-eu-west.prod-eu-west.svc.cluster.local
    google:
      credentialsSecretRef:
        name: google-credentials-eu-west
        key: credentials.json
  ingress:
    enabled: true
    host: sheets-eu-west.example.com
    tls:
      enabled: true
      secretName: tls-eu-west
EOF

# Global load balancer with geo-routing (requires external LB)
# Route us-east-1.compute.amazonaws.com -> sheets-us-east.example.com
# Route eu-west-1.compute.amazonaws.com -> sheets-eu-west.example.com
```

---

## RBAC Reference

The operator requires the following Kubernetes permissions:

### Operator ClusterRole

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: servalsheets-operator
rules:
  # Custom resources
  - apiGroups: ['servalsheets.io']
    resources: ['servalsheets-servers']
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']
  - apiGroups: ['servalsheets.io']
    resources: ['servalsheets-servers/status']
    verbs: ['get', 'update', 'patch']

  # Core resources
  - apiGroups: ['']
    resources: ['services', 'pods', 'configmaps', 'secrets']
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']
  - apiGroups: ['']
    resources: ['events']
    verbs: ['create', 'patch']

  # Apps resources
  - apiGroups: ['apps']
    resources: ['deployments', 'replicasets']
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']

  # Autoscaling resources
  - apiGroups: ['autoscaling']
    resources: ['horizontalpodautoscalers']
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']

  # Networking resources
  - apiGroups: ['networking.k8s.io']
    resources: ['ingresses']
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']

  # Metrics (read-only)
  - apiGroups: ['metrics.k8s.io']
    resources: ['pods', 'nodes']
    verbs: ['get', 'list']
```

### Required Permissions Summary

| Resource                      | API Group           | Verbs                                                         | Purpose                  |
| ----------------------------- | ------------------- | ------------------------------------------------------------- | ------------------------ |
| `servalsheets-servers`        | `servalsheets.io`   | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage custom resources  |
| `servalsheets-servers/status` | `servalsheets.io`   | `get`, `update`, `patch`                                      | Update CR status         |
| `services`                    | Core (`""`)         | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage Services          |
| `pods`                        | Core (`""`)         | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage Pods              |
| `configmaps`                  | Core (`""`)         | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage ConfigMaps        |
| `secrets`                     | Core (`""`)         | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage Secrets           |
| `events`                      | Core (`""`)         | `create`, `patch`                                             | Create Kubernetes events |
| `deployments`                 | `apps`              | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage Deployments       |
| `replicasets`                 | `apps`              | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage ReplicaSets       |
| `horizontalpodautoscalers`    | `autoscaling`       | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage HPAs              |
| `ingresses`                   | `networking.k8s.io` | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` | Manage Ingress           |
| `pods`, `nodes`               | `metrics.k8s.io`    | `get`, `list`                                                 | Read metrics (for HPA)   |

### Minimal User Permissions

Users only need permissions to manage `ServalSheetsServer` resources in their namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: servalsheets-user
  namespace: my-namespace
rules:
  - apiGroups: ['servalsheets.io']
    resources: ['servalsheets-servers']
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']
  - apiGroups: ['servalsheets.io']
    resources: ['servalsheets-servers/status']
    verbs: ['get']
```

The operator handles all underlying Kubernetes resources automatically.

---

## Troubleshooting

### Common Issues

#### Issue 1: Operator Not Starting

**Symptoms:**

- Operator pod in `CrashLoopBackOff` or `Error` state
- Operator logs show RBAC permission errors

**Solution:**

```bash
# Check operator pod status
kubectl get pods -n servalsheets-system

# View operator logs
kubectl logs -n servalsheets-system -l app=servalsheets-operator

# Verify RBAC is installed
kubectl get clusterrole servalsheets-operator
kubectl get clusterrolebinding servalsheets-operator

# Re-apply RBAC if missing
kubectl apply -f k8s/operator/rbac.yaml
```

#### Issue 2: CRD Not Found

**Symptoms:**

- Error: `the server doesn't have a resource type "servalsheets-servers"`
- `kubectl get sss` fails

**Solution:**

```bash
# Check if CRD is installed
kubectl get crd servalsheets-servers.servalsheets.io

# If missing, install CRD
kubectl apply -f k8s/crds/servalsheets-server.yaml

# Verify CRD is established
kubectl get crd servalsheets-servers.servalsheets.io -o jsonpath='{.status.conditions[?(@.type=="Established")].status}'
# Should output: True
```

#### Issue 3: Pods Not Starting

**Symptoms:**

- Pods in `ImagePullBackOff`, `ErrImagePull`, or `CrashLoopBackOff`
- Deployment shows 0 ready replicas

**Solution:**

```bash
# Check ServalSheetsServer status
kubectl describe sss my-server -n my-namespace

# Check pod events
kubectl get pods -n my-namespace
kubectl describe pod <pod-name> -n my-namespace

# Common causes:
# 1. Image not found - verify image repository and tag
# 2. Image pull secrets missing - add imagePullSecrets to spec
# 3. Secrets missing - create required secrets (google-credentials, oauth-client-secret)
# 4. Resource limits too low - increase CPU/memory requests

# View pod logs
kubectl logs <pod-name> -n my-namespace
```

#### Issue 4: HPA Not Scaling

**Symptoms:**

- HPA shows `<unknown>` for current metrics
- Pods not scaling despite high CPU/memory

**Solution:**

```bash
# Check HPA status
kubectl get hpa -n my-namespace
kubectl describe hpa <hpa-name> -n my-namespace

# Common causes:
# 1. Metrics server not installed
kubectl get deployment metrics-server -n kube-system

# 2. Metrics not available yet (wait 1-2 minutes after pod start)
kubectl top pods -n my-namespace

# 3. Resource requests not set (HPA requires requests)
# Verify in ServalSheetsServer spec:
#   resources:
#     requests:
#       cpu: "100m"
#       memory: "128Mi"
```

#### Issue 5: Ingress Not Working

**Symptoms:**

- 404 or 503 errors when accessing ingress hostname
- TLS certificate errors

**Solution:**

```bash
# Check Ingress resource
kubectl get ingress -n my-namespace
kubectl describe ingress <ingress-name> -n my-namespace

# Verify Ingress controller is installed
kubectl get pods -n ingress-nginx  # or kube-system

# Check Service and Endpoints
kubectl get svc -n my-namespace
kubectl get endpoints -n my-namespace

# Test Service directly (port-forward)
kubectl port-forward -n my-namespace svc/<service-name> 8080:80
curl http://localhost:8080/health

# Check TLS certificate
kubectl get secret <tls-secret-name> -n my-namespace
kubectl describe certificate <cert-name> -n my-namespace  # if using cert-manager
```

#### Issue 6: OAuth Authentication Failing

**Symptoms:**

- 401 Unauthorized errors
- OAuth callback errors

**Solution:**

```bash
# Verify OAuth secret exists
kubectl get secret oauth-client-secret -n my-namespace
kubectl describe secret oauth-client-secret -n my-namespace

# Check OAuth configuration in ServalSheetsServer
kubectl get sss <server-name> -n my-namespace -o yaml | grep -A 10 oauth

# View server logs for OAuth errors
kubectl logs -n my-namespace -l app=<server-name> | grep -i oauth

# Common issues:
# 1. clientSecretRef points to wrong secret/key
# 2. OAuth issuer URL incorrect or unreachable
# 3. Redirect URI not configured in OAuth provider
```

#### Issue 7: Google API Quota Exceeded

**Symptoms:**

- 429 rate limit errors in logs
- Slow response times

**Solution:**

```bash
# View server logs
kubectl logs -n my-namespace -l app=<server-name> | grep -i "quota\|429"

# Check current request rate
kubectl top pods -n my-namespace

# Solutions:
# 1. Enable Redis caching to reduce API calls
#    spec:
#      config:
#        redis:
#          enabled: true
#          host: redis-service
#
# 2. Scale down replicas to reduce total API usage
#    kubectl scale sss <server-name> -n my-namespace --replicas=1
#
# 3. Request quota increase from Google Cloud Console
#    https://console.cloud.google.com/apis/api/sheets.googleapis.com/quotas
```

### Debug Commands Reference

```bash
# View all resources created by operator
kubectl get all,ingress,hpa,configmaps,secrets -n my-namespace -l app=<server-name>

# Watch operator reconciliation
kubectl logs -n servalsheets-system -l app=servalsheets-operator -f

# Check operator controller manager metrics (if exposed)
kubectl port-forward -n servalsheets-system svc/servalsheets-operator-metrics 8080:8080
curl http://localhost:8080/metrics

# Get all events in namespace (sorted)
kubectl get events -n my-namespace --sort-by='.lastTimestamp'

# Describe all pods
kubectl describe pods -n my-namespace

# Check resource usage
kubectl top pods -n my-namespace
kubectl top nodes
```

### Getting Help

If you're still experiencing issues:

1. **Check operator logs**: `kubectl logs -n servalsheets-system -l app=servalsheets-operator`
2. **Check server logs**: `kubectl logs -n <namespace> -l app=<server-name>`
3. **Gather diagnostics**:

   ```bash
   kubectl get sss <server-name> -n <namespace> -o yaml > server.yaml
   kubectl describe sss <server-name> -n <namespace> > describe.txt
   kubectl logs -n <namespace> -l app=<server-name> --tail=500 > logs.txt
   ```

4. **Open an issue**: https://github.com/yourusername/servalsheets/issues with diagnostics attached

---

## Next Steps

- [Helm](./helm) - Package management
- [Monitoring](./monitoring) - Prometheus + Grafana
- [AWS](./aws) - ECS Fargate deployment
