---
title: 'Runbook: Emergency Kill Switch'
category: general
last_updated: 2026-03-15
description: 'Severity: P0 (use when all other options are exhausted)'
version: 1.6.0
tags: [docker, kubernetes]
---

# Runbook: Emergency Kill Switch

**Severity:** P0 (use when all other options are exhausted)
**Effect:** All tool calls return an immediate error — no Google API traffic, no auth checks.
**Reversible:** Yes, within seconds of restart.

---

## When to Use

Activate the kill switch when:

- A security vulnerability is being actively exploited (credential leak, injection attack)
- Tool rug-pull attack detected (hash mismatch in `/.well-known/mcp/tool-hashes`)
- Runaway API quota consumption that cannot be stopped by rate limiting
- Production incident requiring full traffic halt while investigating

**Do NOT use** for normal maintenance, deployments, or partial outages — use the standard graceful shutdown instead (`npm stop` or `SIGTERM`).

---

## Step 1: Activate the Kill Switch

```bash
# Show current status
npm run emergency:disable -- --status

# Activate with a reason
npm run emergency:disable "Security incident - credential leak suspected"
```

This writes `.serval/kill-switch.json` with the activation timestamp and reason.

## Step 2: Apply Immediately (Restart)

The kill switch only takes effect after the server reads the env var at startup:

```bash
# Stop the current server
kill -SIGTERM $(pgrep -f "node dist/cli.js")

# Start with kill switch active
SERVALSHEETS_KILL_SWITCH=true npm start
```

For Docker deployments:

```bash
docker stop servalsheets
docker run -e SERVALSHEETS_KILL_SWITCH=true servalsheets
```

For Kubernetes:

```bash
kubectl set env deployment/servalsheets SERVALSHEETS_KILL_SWITCH=true
kubectl rollout restart deployment/servalsheets
```

## Step 3: Verify Kill Switch is Active

```bash
# All tool calls should return INTERNAL_ERROR with maintenance message
curl -s http://localhost:3000/health | jq .status

# Check server logs for kill switch warning:
# "Kill switch active — rejecting tool call"
```

## Step 4: Investigate and Remediate

While the kill switch is active:

1. Check `audit-logs/` for suspicious patterns
2. If credential leak: rotate OAuth tokens at Google Cloud Console
3. If tool hash mismatch: check `src/security/tool-hashes.baseline.json` vs current hashes
4. If quota exhaustion: check Google Cloud quota dashboard

## Step 5: Deactivate

```bash
# Mark kill switch inactive
npm run emergency:disable -- --off

# Restart server normally
npm start
```

For Kubernetes:

```bash
kubectl set env deployment/servalsheets SERVALSHEETS_KILL_SWITCH-
kubectl rollout restart deployment/servalsheets
```

## Step 6: Post-Incident

After service is restored:

1. Update `.serval/kill-switch.json` with resolution notes
2. File a post-mortem using the template in `docs/security/INCIDENT_RESPONSE_PLAN.md`
3. Update runbook if any steps were unclear or missing

---

## Reference

- Kill switch env var: `SERVALSHEETS_KILL_SWITCH` (boolean, default `false`)
- State file: `.serval/kill-switch.json` (informational — actual enforcement is via env var)
- Script: `scripts/emergency-disable.ts`
- Incident response plan: `docs/security/INCIDENT_RESPONSE_PLAN.md`
