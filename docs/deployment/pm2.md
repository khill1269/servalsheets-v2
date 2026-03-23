---
title: PM2 Deployment
category: general
last_updated: 2026-01-31
description: Deploy ServalSheets using PM2 process manager for Node.js applications.
version: 1.6.0
tags: [deployment, docker, kubernetes]
---

# PM2 Deployment

Deploy ServalSheets using PM2 process manager for Node.js applications.

## Overview

PM2 is a production process manager for Node.js applications with:

- Built-in load balancer
- Automatic restart on crash
- Zero-downtime deployments
- Process monitoring
- Log management

## Prerequisites

- Node.js 18+ installed
- PM2 installed globally
- ServalSheets npm package
- Google Cloud credentials configured

## Installation

### Install PM2 Globally

```bash
npm install -g pm2
```

### Install ServalSheets

```bash
npm install -g servalsheets
```

## Configuration

### Create PM2 Ecosystem File

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'servalsheets',
      script: 'servalsheets',
      args: 'start --http',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        GOOGLE_CLIENT_ID: 'your-client-id',
        GOOGLE_CLIENT_SECRET: 'your-client-secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/oauth/callback',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
    },
  ],
};
```

### Environment Configuration

Alternative: Use `.env` file:

```env
NODE_ENV=production
PORT=3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
```

## Deployment

### Start Application

```bash
pm2 start ecosystem.config.js
```

### Check Status

```bash
pm2 status
pm2 list
```

### View Logs

```bash
# All logs
pm2 logs

# Specific app
pm2 logs servalsheets

# Last 100 lines
pm2 logs --lines 100
```

### Monitor Resources

```bash
pm2 monit
```

## Process Management

### Restart Application

```bash
# Restart all
pm2 restart all

# Restart specific app
pm2 restart servalsheets

# Reload (zero-downtime)
pm2 reload servalsheets
```

### Stop Application

```bash
pm2 stop servalsheets
```

### Delete Process

```bash
pm2 delete servalsheets
```

### Save Process List

```bash
pm2 save
```

## Auto-Start on Boot

### Generate Startup Script

```bash
pm2 startup
```

Follow the displayed command to set up auto-start.

### Save Current Processes

```bash
pm2 save
```

## Cluster Mode

### Load Balancing

PM2 can run multiple instances:

```javascript
{
  instances: 'max',  // Use all CPU cores
  exec_mode: 'cluster'
}
```

### Zero-Downtime Reload

```bash
pm2 reload servalsheets
```

Gracefully restarts instances one by one.

## Log Management

### Rotate Logs

Install PM2 log rotate module:

```bash
pm2 install pm2-logrotate
```

Configure rotation:

```bash
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### Clear Logs

```bash
pm2 flush
```

## Monitoring

### Built-in Monitoring

```bash
pm2 monit
```

### Web Dashboard

```bash
pm2 web
```

Access at http://localhost:9615

### PM2 Plus (Cloud Monitoring)

```bash
pm2 link <secret_key> <public_key>
```

## Production Best Practices

### Resource Limits

```javascript
{
  max_memory_restart: '500M',  // Restart if exceeds memory
  max_restarts: 10,            // Max restart attempts
  min_uptime: '10s'            // Min uptime before restart
}
```

### Error Handling

```javascript
{
  autorestart: true,
  restart_delay: 4000,
  exp_backoff_restart_delay: 100
}
```

### Process Scaling

```bash
# Scale to 4 instances
pm2 scale servalsheets 4

# Scale up by 2
pm2 scale servalsheets +2

# Scale down to 2
pm2 scale servalsheets 2
```

## Health Checks

### HTTP Health Endpoint

Add to ecosystem config:

```javascript
{
  health_check: {
    url: 'http://localhost:3000/health',
    interval: 10000,
    timeout: 5000
  }
}
```

### Custom Health Script

```javascript
{
  name: 'servalsheets-health',
  script: './health-check.js',
  cron_restart: '0 */1 * * *'  // Restart every hour
}
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
pm2 logs servalsheets --err

# Verify config
pm2 show servalsheets

# Delete and restart
pm2 delete servalsheets
pm2 start ecosystem.config.js
```

### High Memory Usage

```bash
# Check memory
pm2 list

# Lower max memory threshold
# In ecosystem.config.js:
max_memory_restart: '300M'
```

### Port Already in Use

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>

# Or change port in config
```

## Updates and Upgrades

### Update ServalSheets

```bash
npm update -g servalsheets
pm2 reload servalsheets
```

### Update PM2

```bash
npm install -g pm2@latest
pm2 update
```

## Integration with Nginx

### Reverse Proxy Configuration

```nginx
server {
  listen 80;
  server_name your-domain.com;

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

### SSL with Let's Encrypt

```bash
certbot --nginx -d your-domain.com
```

## Comparison with Other Deployment Methods

| Feature    | PM2           | Docker     | Kubernetes  |
| ---------- | ------------- | ---------- | ----------- |
| Setup      | Simple        | Moderate   | Complex     |
| Scaling    | Manual        | Manual     | Auto        |
| Monitoring | Built-in      | External   | Built-in    |
| Best For   | Single server | Containers | Large scale |

## Related Documentation

- [Docker Deployment](./docker.md) - Container-based deployment
- [Kubernetes Deployment](./kubernetes.md) - Orchestrated deployment
- [Monitoring Guide](../guides/MONITORING.md) - Production monitoring
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)

## Support

For PM2-specific issues:

- Check PM2 logs first
- Verify ecosystem config
- Review process status
- Consult PM2 documentation
