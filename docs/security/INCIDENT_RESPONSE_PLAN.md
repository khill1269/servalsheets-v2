---
title: ServalSheets Incident Response Plan
category: general
last_updated: 2026-03-15
description: 'Version: 1.0'
version: 1.6.0
tags: [security, sheets, grafana]
---

# ServalSheets Incident Response Plan

**Version:** 1.0
**Maintained by:** ServalSheets maintainers
**Review cadence:** Quarterly or after any P0/P1 incident

---

## Severity Tiers

| Tier | Name     | Definition                                                                                  | Response SLA | Resolution SLA |
| ---- | -------- | ------------------------------------------------------------------------------------------- | ------------ | -------------- |
| P0   | Critical | Complete service outage, confirmed data breach, credential compromise, active exploitation  | 15 min       | 2 hours        |
| P1   | High     | Partial outage affecting >10% of users, auth failures, quota exhaustion, unconfirmed breach | 30 min       | 4 hours        |
| P2   | Medium   | Degraded performance, elevated error rate (<10% affected), single-user data loss            | 2 hours      | 24 hours       |
| P3   | Low      | Cosmetic defects, documentation errors, single-user UX issues                               | 24 hours     | 1 week         |

---

## Detection Sources

| Source                   | What it catches                                                            | How to access                                     |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Grafana alerts           | Quota near limit, circuit breaker open, high error rate, memory exhaustion | `deployment/observability/alertmanager-rules.yml` |
| Sentry / structured logs | Unhandled exceptions, auth failures, rate limit violations                 | `pino` logger → stdout → log aggregator           |
| `audit-logs/`            | All mutation operations with principal IDs, IP addresses, timestamps       | `audit-logs/YYYY-MM-DD.jsonl`                     |
| Health endpoint          | Server liveness, tool count, last successful call                          | `GET /health`                                     |
| Tool hash endpoint       | Tool description integrity                                                 | `GET /.well-known/mcp/tool-hashes`                |
| User reports             | Issues not caught by monitoring                                            | GitHub Issues                                     |

---

## Response Phases

### Phase 1: Detect

1. Receive alert or report
2. Determine severity tier (use table above)
3. Assign incident commander (IC) for P0/P1
4. Open incident thread (Slack/Discord/email)

### Phase 2: Assess

```bash
# Check server health
curl -s http://localhost:3000/health | jq .

# Check tool integrity (rug-pull detection)
curl -s http://localhost:3000/.well-known/mcp/tool-hashes | jq '.generated, (.tools | keys | length)'

# Check recent audit log for anomalies
tail -100 audit-logs/$(date +%Y-%m-%d).jsonl | jq 'select(.action | startswith("delete") or startswith("clear") or startswith("share"))' | head -20

# Check current quota status
grep -i "quota\|rate.limit" audit-logs/$(date +%Y-%m-%d).jsonl | tail -20
```

### Phase 3: Contain

**If P0 (active exploit or credential compromise):**

```bash
# Activate kill switch immediately
npm run emergency:disable "P0 incident: [reason]"
SERVALSHEETS_KILL_SWITCH=true npm start
```

**If P1 (quota exhaustion):**

- Reduce rate limits in `src/config/env.ts` → `RATE_LIMIT_REQUESTS_PER_MINUTE`
- Enable read-only mode if supported

**If auth/credential leak:**

```bash
# Revoke all Google OAuth tokens immediately
# Google Cloud Console → APIs & Services → Credentials → Revoke
# Then rotate client secret in .env
```

### Phase 4: Investigate

Collect evidence before making changes:

```bash
# Copy audit logs for analysis
cp -r audit-logs/ /tmp/incident-$(date +%Y%m%d%H%M%S)/

# Check git log for unauthorized changes
git log --since="24 hours ago" --all --oneline

# Verify tool descriptions haven't changed
npm run security:tool-hashes:check

# Check for anomalous principals in recent mutations
jq '.principalId' audit-logs/$(date +%Y-%m-%d).jsonl | sort | uniq -c | sort -rn | head -20
```

### Phase 5: Remediate

Apply the minimum change needed to restore safety:

| Scenario                           | Remediation                                                            |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Credential leak                    | Revoke tokens, rotate client secret, invalidate all sessions           |
| Tool rug-pull detected             | Stop server, restore `tool-hashes.baseline.json` from git, restart     |
| DDoS / quota exhaustion            | Activate rate limiting, add IP blocks at reverse proxy, contact Google |
| Data modification by attacker      | Restore from Google Sheets version history (`sheets_history.timeline`) |
| MCP injection via tool description | Update `DANGEROUS_FORMULA_PATTERN` in `mutation-safety-middleware.ts`  |

### Phase 6: Recover

```bash
# Deactivate kill switch
npm run emergency:disable -- --off

# Restart normally
npm start

# Verify health
curl -s http://localhost:3000/health | jq .status
```

---

## Playbooks by Scenario

### S1: Credential / Token Compromise

**Indicators:** Anomalous API calls from unexpected IPs, unauthorized spreadsheet access in audit logs.

1. Activate kill switch (`npm run emergency:disable`)
2. Google Cloud Console → Credentials → Revoke ALL OAuth tokens for the app
3. Rotate `GOOGLE_CLIENT_SECRET` in production environment
4. Delete `.serval/tokens/` directory (revoke cached tokens)
5. Review `audit-logs/` for unauthorized operations → determine scope of access
6. If user data accessed: notify affected users within 72 hours (GDPR Art. 33)
7. Restart server, require re-auth for all users
8. File post-mortem

### S2: Tool Rug-Pull / Description Tampering

**Indicators:** `npm run security:tool-hashes:check` fails; `/.well-known/mcp/tool-hashes` returns different hashes than the committed baseline.

1. Immediately stop accepting connections
2. Check `git log src/mcp/registration/tool-definitions.ts` for unauthorized commits
3. Diff current descriptions against `src/security/tool-hashes.baseline.json`
4. If unauthorized: revert to last known-good commit (`git revert`)
5. If authorized but baseline wasn't updated: run `npm run security:tool-hashes` and commit
6. Audit which LLM interactions occurred while tampered descriptions were live
7. Notify users if tampered descriptions could have caused unintended operations

### S3: DDoS / Quota Exhaustion

**Indicators:** Google Sheets API returning 429/QUOTA_EXCEEDED; Grafana `QuotaNearLimit` alert.

1. Check `_meta.quotaRemaining` — if 0, all new calls will fail immediately
2. Enable emergency rate limiting: set `RATE_LIMIT_REQUESTS_PER_MINUTE=5` in env
3. Identify top consumers: `jq '.principalId' audit-logs/*.jsonl | sort | uniq -c | sort -rn | head -10`
4. Block abusive principals at the reverse proxy
5. Contact Google Cloud support to request quota increase if legitimate
6. Consider enabling read-only mode: set `DISABLE_WRITE_OPERATIONS=true`

### S4: Data Breach / Unauthorized Data Access

**Indicators:** Unauthorized reads in audit logs; user reports missing/modified data.

1. Preserve evidence: copy audit logs before any changes
2. Determine scope: which spreadsheets, which principals, what time window
3. Activate kill switch to prevent further access
4. If personal data exposed: follow GDPR 72-hour notification requirement
5. Work with Google Workspace admin to revoke shared access on affected spreadsheets
6. Use `sheets_history.timeline` to determine what was read/modified
7. Restore from version history if data was modified

---

## Communication Templates

### Status Page (P0/P1)

```
🔴 INCIDENT IN PROGRESS — [Brief description]
Impact: [Who is affected, what functionality is unavailable]
Started: [ISO timestamp]
Status: Investigating / Identified / Monitoring / Resolved
Next update: [time]
```

### User Notification (Data Breach)

```
Subject: Security Notice — Action Required

We identified an incident affecting your ServalSheets data between [start] and [end].

What happened: [Brief description without technical details]
Data affected: [Specific spreadsheets/data types if known]
What we did: [Containment actions taken]
What you should do: [Specific user actions, if any]

Questions: [contact email]
```

---

## Post-Mortem Template

After every P0/P1 incident, complete this within 5 business days:

```markdown
## Incident Post-Mortem: [Title]

**Date:** [ISO date]
**Severity:** P0 / P1
**Duration:** [start] → [end] ([total minutes])
**Incident Commander:** [name]

### Timeline

- HH:MM — [Event]
- HH:MM — [Event]

### Root Cause (5-Whys)

1. Why did X happen? Because Y.
2. Why did Y happen? Because Z.
   ...

### Impact

- Users affected: [count or "unknown"]
- Data affected: [description or "none"]
- Revenue impact: [description or "none"]

### What Went Well

- [item]

### What Went Poorly

- [item]

### Action Items

| Action | Owner  | Due Date |
| ------ | ------ | -------- |
| [Fix]  | [name] | [date]   |
```

---

## Related Resources

- Emergency disable runbook: `docs/runbooks/emergency-disable.md`
- Security docs: `docs/security/`
- Audit log format: `docs/compliance/AUDIT_LOGGING.md`
- RBAC guide: `docs/security/RBAC_GUIDE.md`
- Tool hash verification: `src/security/tool-hash-registry.ts`
- Observability alerts: `deployment/observability/alertmanager-rules.yml`
