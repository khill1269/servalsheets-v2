---
title: TLS/SSL Certificate Rotation
category: runbook
last_updated: 2026-01-31
description: Procedures for rotating TLS/SSL certificates with zero downtime. Covers self-signed, Let's Encrypt, and commercial certificate authorities.
version: 1.6.0
tags: [prometheus, docker, kubernetes]
estimated_time: 15-30 minutes
---

# TLS/SSL Certificate Rotation

## Overview

Procedures for rotating TLS/SSL certificates with zero downtime. Covers self-signed, Let's Encrypt, and commercial certificate authorities.

---

## Certificate Types

### 1. Self-Signed (Development Only)

- ⚠️ **Not for production** - browsers show warnings
- Use for local testing only
- Free, instant, no verification

### 2. Let's Encrypt (Recommended for Production)

- ✅ Free, automated, trusted by all browsers
- 90-day expiration (auto-renewal recommended)
- Rate limits apply

### 3. Commercial CA (DigiCert, GlobalSign, etc.)

- Enterprise validation options
- Extended validation (EV) certificates
- 1-2 year validity
- Cost: $50-$1000+/year

---

## Certificate Expiration Monitoring

### Check Certificate Expiration

```bash
# Check certificate expiration date
echo | openssl s_client -connect servalsheets.example.com:443 -servername servalsheets.example.com 2>/dev/null | openssl x509 -noout -dates

# Output:
# notBefore=Jan  1 00:00:00 2026 GMT
# notAfter=Mar 31 23:59:59 2026 GMT
```

### Automated Monitoring

```bash
#!/bin/bash
# check-cert-expiry.sh

DOMAIN="servalsheets.example.com"
WARN_DAYS=30

# Get expiration date
EXPIRY=$(echo | openssl s_client -connect $DOMAIN:443 -servername $DOMAIN 2>/dev/null | openssl x_client -connect $DOMAIN:443 -servername $DOMAIN 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)

# Convert to epoch
EXPIRY_EPOCH=$(date -j -f "%b %d %T %Y %Z" "$EXPIRY" +%s)
NOW_EPOCH=$(date +%s)

# Calculate days until expiry
DAYS_LEFT=$(( ($EXPIRY_EPOCH - $NOW_EPOCH) / 86400 ))

if [ $DAYS_LEFT -lt $WARN_DAYS ]; then
  echo "WARNING: Certificate expires in $DAYS_LEFT days!"
  # Send alert (email, Slack, PagerDuty, etc.)
  curl -X POST https://hooks.slack.com/... -d "{\"text\": \"ServalSheets certificate expires in $DAYS_LEFT days!\"}"
fi
```

```bash
# Run daily via cron
0 6 * * * /opt/servalsheets/scripts/check-cert-expiry.sh
```

---

## Let's Encrypt Rotation

### Initial Setup (First Time)

```bash
# Install certbot
sudo apt-get install certbot

# Get certificate (standalone mode - requires port 80 free)
sudo certbot certonly --standalone -d servalsheets.example.com

# Certificates saved to:
# /etc/letsencrypt/live/servalsheets.example.com/fullchain.pem
# /etc/letsencrypt/live/servalsheets.example.com/privkey.pem
```

### Automated Renewal

```bash
# Test renewal (dry run)
sudo certbot renew --dry-run

# If successful, set up automatic renewal
sudo certbot renew --deploy-hook "/opt/servalsheets/scripts/reload-certs.sh"

# Or use cron
echo "0 3 * * * certbot renew --quiet --deploy-hook '/opt/servalsheets/scripts/reload-certs.sh'" | sudo crontab -
```

### Reload Script

```bash
#!/bin/bash
# /opt/servalsheets/scripts/reload-certs.sh

# Copy certificates to application directory
cp /etc/letsencrypt/live/servalsheets.example.com/fullchain.pem /opt/servalsheets/certs/cert.pem
cp /etc/letsencrypt/live/servalsheets.example.com/privkey.pem /opt/servalsheets/certs/key.pem

# Reload nginx (zero downtime)
nginx -s reload

# Or restart Docker container
# docker-compose restart nginx

# Or reload Kubernetes secret
# kubectl create secret tls servalsheets-tls \
#   --cert=/etc/letsencrypt/live/servalsheets.example.com/fullchain.pem \
#   --key=/etc/letsencrypt/live/servalsheets.example.com/privkey.pem \
#   --dry-run=client -o yaml | kubectl apply -f -

echo "Certificates reloaded successfully"
```

---

## Commercial Certificate Rotation

### 1. Generate Certificate Signing Request (CSR)

```bash
# Generate private key and CSR
openssl req -new -newkey rsa:2048 -nodes \
  -keyout servalsheets.key \
  -out servalsheets.csr \
  -subj "/C=US/ST=California/L=San Francisco/O=YourCompany/CN=servalsheets.example.com"

# View CSR (submit this to CA)
cat servalsheets.csr
```

### 2. Submit CSR to Certificate Authority

1. Log into CA portal (DigiCert, GlobalSign, etc.)
2. Request new certificate
3. Paste CSR content
4. Complete domain validation
5. Download signed certificate

### 3. Install New Certificate

```bash
# Save certificate files
# - servalsheets.crt (your certificate)
# - intermediate.crt (CA intermediate certificates)
# - root.crt (CA root certificate - optional)

# Create full chain
cat servalsheets.crt intermediate.crt > fullchain.crt

# Install in nginx
sudo cp fullchain.crt /etc/nginx/ssl/servalsheets-fullchain.crt
sudo cp servalsheets.key /etc/nginx/ssl/servalsheets.key
sudo chmod 600 /etc/nginx/ssl/servalsheets.key

# Test configuration
sudo nginx -t

# Reload (zero downtime)
sudo nginx -s reload
```

### 4. Verify Installation

```bash
# Test certificate
openssl s_client -connect servalsheets.example.com:443 -servername servalsheets.example.com

# Check certificate chain
echo | openssl s_client -connect servalsheets.example.com:443 -showcerts

# Verify with online tool
# https://www.ssllabs.com/ssltest/analyze.html?d=servalsheets.example.com
```

---

## Nginx Configuration

```nginx
# /etc/nginx/sites-available/servalsheets
server {
    listen 443 ssl http2;
    server_name servalsheets.example.com;

    # Certificate files
    ssl_certificate /etc/nginx/ssl/servalsheets-fullchain.crt;
    ssl_certificate_key /etc/nginx/ssl/servalsheets.key;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers on;

    # OCSP stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/nginx/ssl/servalsheets-fullchain.crt;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    location / {
        proxy_pass http://localhost:3000;
        # ... other proxy settings
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name servalsheets.example.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Docker/Docker Compose

### Certificate Mounting

```yaml
# docker-compose.yml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - '443:443'
      - '80:80'
    volumes:
      # Mount certificates
      - ./certs/fullchain.pem:/etc/nginx/ssl/cert.pem:ro
      - ./certs/privkey.pem:/etc/nginx/ssl/key.pem:ro
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    restart: unless-stopped

  servalsheets:
    image: servalsheets:latest
    # ... rest of config
```

### Certificate Renewal with Docker

```bash
#!/bin/bash
# renew-docker-certs.sh

# Renew with certbot
certbot renew --quiet

# Copy new certificates to Docker volume
cp /etc/letsencrypt/live/servalsheets.example.com/fullchain.pem ./certs/
cp /etc/letsencrypt/live/servalsheets.example.com/privkey.pem ./certs/

# Reload nginx (zero downtime)
docker-compose exec nginx nginx -s reload

echo "Docker certificates renewed"
```

---

## Kubernetes

### Certificate as Secret

```bash
# Create TLS secret
kubectl create secret tls servalsheets-tls \
  --cert=/path/to/fullchain.pem \
  --key=/path/to/privkey.pem \
  -n servalsheets

# Verify secret
kubectl get secret servalsheets-tls -n servalsheets -o yaml
```

### Ingress with TLS

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: servalsheets
  namespace: servalsheets
  annotations:
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
spec:
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

### Automated Renewal with cert-manager

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

# cert-manager will now automatically:
# - Issue certificates
# - Renew before expiration (30 days)
# - Update Kubernetes secrets
```

---

## AWS Certificate Manager (ACM)

### Using ACM with ALB

```bash
# Request certificate
aws acm request-certificate \
  --domain-name servalsheets.example.com \
  --validation-method DNS

# Get validation CNAME records
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/xxx

# Add CNAME records to Route53 for validation
# Certificate will auto-renew - no manual rotation needed!

# Attach to load balancer
aws elbv2 modify-listener \
  --listener-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/... \
  --certificates CertificateArn=arn:aws:acm:us-east-1:123456789012:certificate/xxx
```

**Advantage**: ACM handles automatic renewal - no manual rotation needed!

---

## GCP Managed Certificates

```yaml
# k8s/managed-certificate.yaml
apiVersion: networking.gke.io/v1
kind: ManagedCertificate
metadata:
  name: servalsheets-cert
spec:
  domains:
    - servalsheets.example.com
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: servalsheets
  annotations:
    networking.gke.io/managed-certificates: 'servalsheets-cert'
    kubernetes.io/ingress.class: 'gce'
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

GCP automatically provisions and renews Let's Encrypt certificates!

---

## Zero-Downtime Rotation

### Strategy

1. **Generate new certificate** (with same private key or new)
2. **Install new certificate** alongside old
3. **Test new certificate** on different port/subdomain
4. **Atomic swap** - update nginx/load balancer config
5. **Reload** (not restart) - zero downtime
6. **Verify** new certificate is serving
7. **Remove old certificate** (after confirmation)

### Nginx Hot Reload

```bash
# Test new configuration
nginx -t

# Reload (zero downtime - keeps existing connections)
nginx -s reload

# NOT restart (causes brief downtime)
# systemctl restart nginx  # ❌ Don't do this
```

### HAProxy Zero-Downtime Reload

```bash
# Combine cert and key for HAProxy
cat fullchain.pem privkey.pem > /etc/haproxy/certs/servalsheets.pem

# Reload HAProxy (zero downtime)
systemctl reload haproxy
```

---

## Troubleshooting

### Common Issues

**Problem**: Certificate shows as "Not Secure" in browser

**Check**:

```bash
# Verify certificate is valid
openssl s_client -connect servalsheets.example.com:443 -servername servalsheets.example.com | grep "Verify return code"
# Should show: Verify return code: 0 (ok)

# Check certificate chain
echo | openssl s_client -connect servalsheets.example.com:443 -showcerts

# Common causes:
# - Missing intermediate certificates
# - Certificate for wrong domain
# - Expired certificate
```

**Problem**: "Certificate expired" error

**Solution**:

```bash
# Check expiration
echo | openssl s_client -connect servalsheets.example.com:443 2>/dev/null | openssl x509 -noout -dates

# If expired:
# 1. Renew certificate (Let's Encrypt: certbot renew)
# 2. Install new certificate
# 3. Reload server

# Prevent future expiration:
# Set up automated renewal (see above)
```

**Problem**: Mixed content warnings

**Solution**:

```bash
# Ensure all resources loaded over HTTPS
# Check nginx config:
add_header Content-Security-Policy "upgrade-insecure-requests" always;

# Or update application URLs to use HTTPS
```

---

## Security Best Practices

### 1. Secure Private Keys

```bash
# Restrict permissions
chmod 600 /etc/nginx/ssl/servalsheets.key
chown root:root /etc/nginx/ssl/servalsheets.key

# Never commit private keys to git!
# Add to .gitignore
echo "*.key" >> .gitignore
echo "*.pem" >> .gitignore
```

### 2. Use Strong Cipher Suites

```nginx
# Disable weak ciphers
ssl_ciphers 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256';
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
```

### 3. Enable HSTS

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

### 4. Regular Security Audits

```bash
# Test with SSL Labs
# https://www.ssllabs.com/ssltest/

# Should achieve A or A+ rating
```

---

## Monitoring

### Prometheus Metrics

```yaml
# prometheus-rules.yaml
groups:
  - name: certificate_alerts
    rules:
      - alert: CertificateExpiringSoon
        expr: ssl_certificate_expiry_seconds < 604800 # 7 days
        labels:
          severity: warning
        annotations:
          summary: 'SSL certificate expiring soon'
          description: 'Certificate for servalsheets.example.com expires in {{ $value | humanizeDuration }}'

      - alert: CertificateExpired
        expr: ssl_certificate_expiry_seconds < 0
        labels:
          severity: critical
        annotations:
          summary: 'SSL certificate EXPIRED'
```

---

## Summary Checklist

### Before Rotation

- [ ] Check current certificate expiration
- [ ] Generate or obtain new certificate
- [ ] Test new certificate in staging
- [ ] Schedule maintenance window (if downtime required)
- [ ] Backup current certificates

### During Rotation

- [ ] Install new certificate
- [ ] Update server configuration
- [ ] Test configuration (nginx -t)
- [ ] Reload server (nginx -s reload)
- [ ] Verify new certificate serving

### After Rotation

- [ ] Test HTTPS connectivity
- [ ] Verify certificate in browser
- [ ] Check SSL Labs rating
- [ ] Update monitoring
- [ ] Document rotation date

### Ongoing

- [ ] Monitor certificate expiration
- [ ] Set up automated renewal
- [ ] Review security configuration quarterly
- [ ] Update certificates across all environments

---

## References

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Certbot Documentation](https://certbot.eff.org/docs/)
- [SSL Labs Best Practices](https://github.com/ssllabs/research/wiki/SSL-and-TLS-Deployment-Best-Practices)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
- [cert-manager Documentation](https://cert-manager.io/docs/)
