---
title: ServalSheets Firewall Configuration Guide
category: guide
last_updated: 2026-01-31
description: This guide explains how to configure firewall rules for ServalSheets when deploying behind a firewall or in a cloud environment.
version: 1.6.0
tags: [prometheus]
audience: user
difficulty: intermediate
---

# ServalSheets Firewall Configuration Guide

This guide explains how to configure firewall rules for ServalSheets when deploying behind a firewall or in a cloud environment.

## Overview

When deploying ServalSheets as a remote MCP server accessible by Claude, you must configure your firewall to allow incoming connections from Anthropic's infrastructure.

## Claude IP Addresses

Anthropic publishes the IP addresses used by Claude for MCP connections. These must be allowlisted in your firewall.

### Getting Current IP Addresses

The authoritative source for Claude's IP addresses is:

**https://docs.claude.com/en/api/ip-addresses**

Always check this URL for the most up-to-date list before configuring your firewall.

### Example IP Ranges (Subject to Change)

As of January 2026, Claude may connect from the following IP ranges:

```
# Note: These are examples - always verify at docs.claude.com
# IPv4 ranges
35.192.0.0/12
34.64.0.0/10

# IPv6 ranges (if applicable)
2600:1900::/28
```

⚠️ **Important**: IP addresses may change. Set up monitoring to check for updates.

## Firewall Configuration Examples

### AWS Security Group

```bash
# Create security group
aws ec2 create-security-group \
  --group-name servalsheets-claude \
  --description "Allow Claude MCP connections"

# Add inbound rules for Claude IPs (example)
aws ec2 authorize-security-group-ingress \
  --group-name servalsheets-claude \
  --protocol tcp \
  --port 443 \
  --cidr 35.192.0.0/12

aws ec2 authorize-security-group-ingress \
  --group-name servalsheets-claude \
  --protocol tcp \
  --port 443 \
  --cidr 34.64.0.0/10
```

### Google Cloud Firewall

```bash
# Create firewall rule
gcloud compute firewall-rules create allow-claude-mcp \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges="35.192.0.0/12,34.64.0.0/10" \
  --target-tags=servalsheets
```

### Azure Network Security Group

```bash
# Create NSG rule
az network nsg rule create \
  --resource-group myResourceGroup \
  --nsg-name myNSG \
  --name AllowClaudeMCP \
  --priority 100 \
  --source-address-prefixes "35.192.0.0/12" "34.64.0.0/10" \
  --destination-port-ranges 443 \
  --access Allow \
  --protocol Tcp
```

### Linux iptables

```bash
# Allow Claude IP ranges
iptables -A INPUT -p tcp --dport 443 -s 35.192.0.0/12 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -s 34.64.0.0/10 -j ACCEPT

# Save rules
iptables-save > /etc/iptables/rules.v4
```

### Linux ufw (Ubuntu)

```bash
# Allow Claude IP ranges
ufw allow from 35.192.0.0/12 to any port 443 proto tcp
ufw allow from 34.64.0.0/10 to any port 443 proto tcp

# Reload
ufw reload
```

### Nginx (Rate Limiting by IP)

```nginx
# /etc/nginx/conf.d/claude-allowlist.conf

geo $claude_client {
    default 0;
    35.192.0.0/12 1;
    34.64.0.0/10 1;
}

server {
    listen 443 ssl;
    server_name servalsheets.example.com;

    # Only allow Claude IPs
    if ($claude_client = 0) {
        return 403;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Required Ports

| Port | Protocol | Purpose                  |
| ---- | -------- | ------------------------ |
| 443  | TCP/TLS  | HTTPS MCP connections    |
| 80   | TCP      | HTTP redirect (optional) |

## TLS/SSL Requirements

ServalSheets requires TLS for production deployments:

1. **Valid Certificate**: Use a certificate from a trusted CA (Let's Encrypt, etc.)
2. **TLS 1.2+**: Minimum TLS 1.2, prefer TLS 1.3
3. **Strong Ciphers**: Use modern cipher suites

### Let's Encrypt Setup (Certbot)

```bash
# Install certbot
apt-get install certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d servalsheets.example.com

# Auto-renewal
certbot renew --dry-run
```

## CORS Configuration

ServalSheets includes CORS settings for Claude domains:

```bash
# Default CORS origins (in .env or environment)
CORS_ORIGINS="https://claude.ai,https://claude.com"
```

Ensure your reverse proxy doesn't override these headers.

## Health Check Endpoint

ServalSheets provides a health check endpoint for load balancers:

```
GET /health
```

Response:

```json
{
  "status": "healthy",
  "version": "1.6.0",
  "uptime": 12345
}
```

Configure your load balancer to use this endpoint for health checks.

## Monitoring and Alerting

### Recommended Monitoring

1. **Connection Metrics**
   - Successful connections from Claude IPs
   - Failed connection attempts
   - TLS handshake errors

2. **IP Address Updates**
   - Set up alerts to check docs.claude.com weekly
   - Monitor for new IP ranges in Anthropic announcements

3. **Certificate Expiry**
   - Alert 30 days before certificate expiration
   - Automate renewal with certbot

### Example Prometheus Alerts

```yaml
groups:
  - name: servalsheets
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: High error rate on ServalSheets

      - alert: CertificateExpiringSoon
        expr: probe_ssl_earliest_cert_expiry - time() < 86400 * 30
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: TLS certificate expiring within 30 days
```

## Troubleshooting

### Connection Refused

1. Check firewall rules are applied: `iptables -L -n`
2. Verify Claude IP ranges are current
3. Check service is running: `systemctl status servalsheets`

### TLS Errors

1. Verify certificate is valid: `openssl s_client -connect yourserver:443`
2. Check certificate chain is complete
3. Ensure TLS version compatibility

### CORS Errors

1. Check CORS_ORIGINS environment variable
2. Verify reverse proxy isn't stripping headers
3. Check browser console for specific CORS errors

## Security Best Practices

1. **Principle of Least Privilege**: Only allow Claude IPs, not 0.0.0.0/0
2. **Regular Audits**: Review firewall rules monthly
3. **Logging**: Enable connection logging for security analysis
4. **Rate Limiting**: Implement rate limiting at the application level
5. **Updates**: Keep ServalSheets and dependencies updated

## Quick Reference

| Setting      | Value                 |
| ------------ | --------------------- |
| Port         | 443 (HTTPS)           |
| Protocol     | TCP                   |
| TLS Version  | 1.2+                  |
| IP Source    | Check docs.claude.com |
| CORS         | claude.ai, claude.com |
| Health Check | /health               |

---

_Always verify current Claude IP addresses at https://docs.claude.com/en/api/ip-addresses before configuring firewall rules._
